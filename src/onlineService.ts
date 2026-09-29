import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { isAbortError, withRetry } from "./lib/retry";

// ---------------------------------------------------------------------------
// Retry policy for this module
//
// The rule is read/write, not "important" vs "not important": `withRetry` is
// applied to PURE READS only. A read has no side effects, so replaying it
// after a transient Supabase blip is free and turns "the badge showed 0" into
// "the badge recovered on its own".
//
// Nothing that writes is retried, and that is deliberate rather than an
// oversight. A timed-out POST is not a failed POST: it may well have been
// applied server-side before the response was lost, so replaying it can
// double-apply. Concretely, blind retry here would mean a second
// `create_multiplayer_game` for one click, an `answer_multiplayer_question`
// scored twice, or a duplicate row in `xp_events` / `reader_sync_snapshots`.
// Retrying is only unambiguously safe for a failure that is provably
// pre-flight — the request never left the machine — and supabase-js does not
// let us distinguish that from a mid-flight timeout. So the writes stay
// un-retried and surface their error to the user, who decides.
// ---------------------------------------------------------------------------

/**
 * Retry predicate for the reads below.
 *
 * Deliberately narrower than `withRetry`'s default of "retry anything": a 401
 * (expired token) or a 403 (RLS) will fail identically every time, so retrying
 * it just spends two extra round trips and delays the error the user is going
 * to see anyway. Everything else — DNS blips, connection resets, 5xx, pooler
 * timeouts — is treated as transient.
 */
function isRetryableRead(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const status = (error as { status?: unknown } | null)?.status;
  return status !== 401 && status !== 403;
}

export type AgeGroup = "under13" | "13to17" | "18plus";
export interface OnlineAccount { onlineUserId:string;email:string;username:string;ageGroup:AgeGroup;friendCode:string;verified:boolean;admin:boolean }
export interface FriendConnection { id:string;userId:string;username:string;status:"pending"|"accepted";direction:"incoming"|"outgoing"|"friend" }
export interface MultiplayerQuestion {bookId:string;bookName:string;chapter:number;verseStart:number;verseEnd:number;text:string;choices:string[];correctIndex:number}
export interface MultiplayerState {code:string;host:boolean;status:"lobby"|"reading"|"answering"|"result"|"finished";questionSeconds:number;readingSeconds:number;currentIndex:number;questionCount:number;phaseStartedAt:string|null;question:(Omit<MultiplayerQuestion,"correctIndex"|"choices">&{choices:string[]|null;correctIndex:number|null})|null;answer:{selectedIndex:number;correct:boolean;points:number}|null;players:{userId:string;username:string;score:number;questionPoints:number|null}[]}

export function subscribeToOnlineUsers(userId:string,onChange:(userIds:Set<string>)=>void){
  const channel=supabase.channel("online-friends",{config:{presence:{key:userId}}});
  channel
    .on("presence",{event:"sync"},()=>onChange(new Set(Object.keys(channel.presenceState()))))
    .subscribe(status=>{
      if(status==="SUBSCRIBED")void channel.track({userId,onlineAt:new Date().toISOString()});
    });
  return ()=>{
    void channel.untrack();
    void supabase.removeChannel(channel);
  };
}

export function onlineErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

async function accountFromUser(user: User): Promise<OnlineAccount> {
  const metadata = user.user_metadata as {
    username?: string;
    age_group?: AgeGroup;
    friend_code?: string;
  };
  // These two reads drop their `error` on the floor, so a transient failure
  // does not throw — it silently degrades the account to `null` and the user
  // is shown as "BibleReader" with friend code "Pending" until the next
  // restart. The retry gives the blip a chance to clear; the trailing `.catch`
  // then falls back to exactly today's behaviour (`null`) once attempts run
  // out, so this changes the failure *rate* but not the failure *mode*.
  const profile = await withRetry(
    async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("username, age_group, friend_code")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    { shouldRetry: isRetryableRead },
  ).catch(() => null);
  const isAdmin = await withRetry(
    async () => {
      const { data, error } = await supabase.rpc("is_app_admin");
      if (error) throw error;
      return Boolean(data);
    },
    { shouldRetry: isRetryableRead },
  ).catch(() => false);
  return {
    onlineUserId: user.id,
    email: user.email ?? "",
    username: profile?.username ?? metadata.username ?? "BibleReader",
    ageGroup: profile?.age_group ?? metadata.age_group ?? "18plus",
    friendCode: profile?.friend_code ?? "Pending",
    verified: Boolean(user.email_confirmed_at),
    admin: isAdmin,
  };
}

export async function restoreOnlineAccount() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session ? await accountFromUser(data.session.user) : null;
}

export async function signUpOnline(input: { email: string; password: string; username: string; ageGroup: AgeGroup }) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(), password: input.password,
    options: { data: { username: input.username.trim(), age_group: input.ageGroup } },
  });
  if (error) throw error;
  return data.session && data.user ? await accountFromUser(data.user) : null;
}

export async function signInOnline(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return await accountFromUser(data.user);
}

export async function signOutOnline() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordRecovery(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
  if (error) throw error;
}

export async function isUsernameAvailable(username: string) {
  // Pure read, so it is safe to replay. The `async … await` is required: the
  // Supabase builders are thenables, not Promises.
  const { data, error } = await withRetry(
    async () => await supabase.rpc("is_username_available", { candidate: username.trim() }),
    { shouldRetry: isRetryableRead },
  );
  if (error) throw error;
  return Boolean(data);
}

export async function uploadInitialProfile(onlineUserId: string) {
  const profileExport = await window.lampLight.invoke<{
    schemaVersion: number;
    sourceDeviceId: string;
    backupPath: string;
    exportedAt: string;
    data: unknown;
  }>("profile:sync-export", onlineUserId);
  const { error } = await supabase.from("profile_sync_snapshots").insert({
    user_id: onlineUserId,
    schema_version: profileExport.schemaVersion,
    source_device_id: profileExport.sourceDeviceId,
    snapshot: { exported_at: profileExport.exportedAt, data: profileExport.data },
  });
  if (error) {
    if (error.code === "23505") throw new Error("Cloud progress already exists. Automatic merging is not enabled yet, so nothing was overwritten.");
    throw error;
  }
  return profileExport.backupPath;
}

export async function hasUploadedProfile(onlineUserId: string) {
  // Pure read. This one gates the whole sync flow (OnlineLive + main.tsx both
  // branch on it), so a dropped request would kick off an upload that was not
  // needed.
  const { data, error } = await withRetry(
    async () =>
      await supabase
        .from("profile_sync_snapshots")
        .select("user_id")
        .eq("user_id", onlineUserId)
        .maybeSingle(),
    { shouldRetry: isRetryableRead },
  );
  if (error) throw error;
  return Boolean(data);
}

type XpSyncEvent = { id: string; amount: number; source: string; createdAt: string };

export async function syncXpLedger(onlineUserId: string) {
  const pending = await window.lampLight.invoke<XpSyncEvent[]>("xp:sync-batch", onlineUserId);
  if (pending.length) {
    const { error } = await supabase.from("xp_events").upsert(
      pending.map((event) => ({
        id: event.id,
        user_id: onlineUserId,
        amount: event.amount,
        source: event.source,
        local_created_at: event.createdAt,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw error;
    await window.lampLight.invoke("xp:mark-synced", pending.map((event) => event.id));
  }
  const { data, error } = await supabase
    .from("xp_events")
    .select("id, amount, source, local_created_at")
    .eq("user_id", onlineUserId);
  if (error) throw error;
  await window.lampLight.invoke("xp:apply-remote", (data ?? []).map((event) => ({
    id: event.id,
    amount: Number(event.amount),
    source: event.source,
    createdAt: event.local_created_at,
  })));
}

export async function syncReaderData(onlineUserId:string){
  const value=await window.lampLight.invoke<{sourceDeviceId:string;snapshot:unknown}>("reader:sync-export",onlineUserId);
  const {error}=await supabase.from("reader_sync_snapshots").upsert({user_id:onlineUserId,source_device_id:value.sourceDeviceId,snapshot:value.snapshot,updated_at:new Date().toISOString()},{onConflict:"user_id"});
  if(error)throw error;
}

export async function listFriendConnections() {
  const { data, error } = await withRetry(
    async () => await supabase.rpc("list_friend_connections"),
    { shouldRetry: isRetryableRead },
  );
  if (error) throw error;
  return (data ?? []).map((row: {id:string;user_id:string;username:string;status:"pending"|"accepted";direction:"incoming"|"outgoing"|"friend"}) => ({
    id:row.id,userId:row.user_id,username:row.username,status:row.status,direction:row.direction,
  })) as FriendConnection[];
}

export async function sendFriendRequest(friendCode: string) {
  const { error } = await supabase.rpc("send_friend_request", { friend_code_input: friendCode.trim() });
  if (error) throw error;
}

export async function respondFriendRequest(id: string, accept: boolean) {
  const { error } = await supabase.rpc("respond_friend_request", { request_id:id, accept_request:accept });
  if (error) throw error;
}

export async function removeFriendConnection(id: string) {
  const { error } = await supabase.rpc("remove_friend_connection", { connection_id:id });
  if (error) throw error;
}

export async function createMultiplayerGame(bookIds:string[],questionCount:number,questionSeconds:number){
  const questions=await window.lampLight.invoke<MultiplayerQuestion[]>("multiplayer:questions",{bookIds,count:questionCount});
  const {data,error}=await supabase.rpc("create_multiplayer_game",{question_seconds_input:questionSeconds,questions_input:questions});
  if(error)throw error;return String(data);
}
export async function joinMultiplayerGame(code:string){const {data,error}=await supabase.rpc("join_multiplayer_game",{code_input:code});if(error)throw error;return String(data)}
export interface GameInvitation {id:string;code:string;username:string}
export async function inviteFriendToGame(code:string,friendId:string){const {error}=await supabase.rpc("invite_friend_to_game",{code_input:code,friend_id:friendId});if(error)throw error}
// Pure read — retried. Polled every 5s for the invite badge, so a single
// blip currently clears the badge until the next tick.
export async function listGameInvitations(){const {data,error}=await withRetry(async()=>await supabase.rpc("list_game_invitations"),{shouldRetry:isRetryableRead});if(error)throw error;return (data??[]) as GameInvitation[]}
// Pure read — retried, but on a deliberately smaller budget than the other
// reads. CustomGame drives the whole round from this and re-polls it every
// 750ms, so the request rate here is the one that can actually hurt a project
// that is already struggling. Two attempts bounds the worst case at 2x the
// baseline request rate (each chain issues at most two requests), against the
// 3x a default budget would allow, and still absorbs a single dropped packet,
// which is the common case. The worst-case 2x is only reachable while requests
// are failing; `load` in CustomGame additionally drops a tick whose chain is
// still in flight, so chains cannot pile up and the sustained rate stays at
// or below the 1x baseline.
export async function getMultiplayerState(code:string){const {data,error}=await withRetry(async()=>await supabase.rpc("multiplayer_game_state",{code_input:code}),{shouldRetry:isRetryableRead,attempts:2,baseDelayMs:200});if(error)throw error;return data as MultiplayerState}

// --- WRITES: deliberately NOT retried. See the retry policy note at the top
// of this file. A replayed `advance_multiplayer_game` / `answer_multiplayer_question`
// can advance a phase or score an answer that already landed server-side, and a
// replayed `dismiss_game_invitation` / `invite_friend_to_game` can leave a
// duplicate row for the user to clear by hand. These surface their error and let
// the user decide. The same applies to the sync writes above
// (`uploadInitialProfile`, `syncXpLedger`, `syncReaderData`) and to every
// friend-request write. ---
export async function dismissGameInvitation(id:string){const {error}=await supabase.rpc("dismiss_game_invitation",{invitation_id:id});if(error)throw error}
export async function advanceMultiplayerGame(code:string){const {error}=await supabase.rpc("advance_multiplayer_game",{code_input:code});if(error)throw error}
export async function answerMultiplayerQuestion(code:string,selectedIndex:number){const {data,error}=await supabase.rpc("answer_multiplayer_question",{code_input:code,selected_index_input:selectedIndex});if(error)throw error;return Number(data)}

export async function expireMultiplayerPhase(code:string,questionIndex:number,phase:string){const {error}=await supabase.rpc("expire_multiplayer_phase",{code_input:code,question_index_input:questionIndex,phase_input:phase});if(error)throw error}
