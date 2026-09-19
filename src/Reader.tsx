import {
  Bookmark,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Minus,
  Plus,
  Search,
  Share2,
  StickyNote,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BibleTranslation,
  Book,
  Verse,
  VerseBookmarkRef,
  VerseHighlight,
  VerseNote,
  VerseSearchResult,
} from "../shared/types";
import { getPrefs } from "./prefs";
import "./reader.css";
import "./reader-chrome.css";
import "./annotations.css";
import "./highlight-text.css";
import "./bookmarks.css";

const api = <T,>(channel: string, payload?: unknown) =>
  window.lampLight.invoke<T>(channel, payload);

async function shareVerse(title: string, text: string) {
  const headline = title.trim() || "Lamp & Light";
  const body = text.trim();
  // Electron exposes navigator.share but it often does nothing on desktop —
  // always use native clipboard + notification via IPC.
  if (window.lampLight) {
    await api("share:clipboard", { title: headline, text: body });
    return;
  }
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({
        title: headline,
        text: body ? `${headline}\n\n${body}` : headline,
      });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    if (e instanceof Error && e.name === "AbortError") return;
  }
  await api("share:clipboard", { title: headline, text: body });
}
const colors = ["yellow", "green", "blue", "pink", "purple"] as const;
type LibraryTab = "highlights" | "bookmarks" | "notes";

export default function Reader({
  books,
  initial,
  back,
}: {
  books: Book[];
  initial?: { bookId: string; chapter: number; from: number; to: number };
  back?: () => void;
}) {
  const readerRef = useRef<HTMLElement>(null);
  const saved = (() => {
    try {
      return JSON.parse(
        localStorage.getItem("bible-reader-preferences") ?? "{}",
      );
    } catch {
      return {};
    }
  })();
  const [bookId, setBookId] = useState(initial?.bookId ?? "GEN");
  const [chapter, setChapter] = useState(initial?.chapter ?? 1);
  const [locationReady, setLocationReady] = useState(Boolean(initial));
  const [translationId, setTranslationId] = useState<string>(
    saved.translationId ?? getPrefs().defaultTranslation,
  );
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loadError, setLoadError] = useState("");
  const [fontSize, setFontSize] = useState<number>(saved.fontSize ?? 21);
  const [lineHeight, setLineHeight] = useState<number>(saved.lineHeight ?? 1.9);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VerseSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [targetVerse, setTargetVerse] = useState<number | null>(null);
  const [editingVerse, setEditingVerse] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingNote, setPendingNote] = useState<{
    bookId: string;
    chapter: number;
    verse: number;
    note: string;
  } | null>(null);
  const [actionVerse, setActionVerse] = useState<number | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("notes");
  const [highlightFilter, setHighlightFilter] = useState<string | null>(null);
  const [allNotes, setAllNotes] = useState<VerseNote[]>([]);
  const [allHighlights, setAllHighlights] = useState<VerseHighlight[]>([]);
  const [allBookmarks, setAllBookmarks] = useState<VerseBookmarkRef[]>([]);
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesFlash, setNotesFlash] = useState<string | null>(null);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const typeMenuRef = useRef<HTMLDivElement>(null);
  const locationMenuRef = useRef<HTMLDivElement>(null);
  const libraryRailRef = useRef<HTMLDivElement>(null);
  const translationMenuRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isQuizPassage = Boolean(initial && back);
  const book = useMemo(
    () => books.find((item) => item.id === bookId) ?? books[0],
    [books, bookId],
  );
  const otBooks = useMemo(
    () => books.filter((item) => item.testament === "OT"),
    [books],
  );
  const ntBooks = useMemo(
    () => books.filter((item) => item.testament === "NT"),
    [books],
  );
  const translation = translations.find((item) => item.id === translationId);
  const load = () => {
    setLoadError("");
    return api<Verse[]>("bible:chapter", { translationId, bookId, chapter })
      .then(setVerses)
      .catch((error) => {
        setVerses([]);
        setLoadError(error instanceof Error ? error.message : String(error));
      });
  };
  const loadLibrary = () =>
    Promise.all([
      api<VerseNote[]>("notes:list").then(setAllNotes),
      api<VerseHighlight[]>("highlights:list").then(setAllHighlights),
      api<VerseBookmarkRef[]>("bookmarks:list").then(setAllBookmarks),
    ]);
  useEffect(() => {
    void api<BibleTranslation[]>("bible:translations").then(setTranslations);
  }, []);
  useEffect(() => {
    if (initial) return;
    void api<{ bookId: string; chapter: number } | null>("reading-position:get")
      .then((position) => {
        if (position) {
          setBookId(position.bookId);
          setChapter(position.chapter);
        }
      })
      .finally(() => setLocationReady(true));
  }, []);
  useEffect(() => {
    if (!isQuizPassage) void loadLibrary();
  }, [isQuizPassage]);
  useEffect(() => {
    if (libraryOpen && !isQuizPassage) void loadLibrary();
  }, [libraryOpen, isQuizPassage]);
  useEffect(() => {
    if (!notesFlash) return;
    const t = setTimeout(() => setNotesFlash(null), 2500);
    return () => clearTimeout(t);
  }, [notesFlash]);
  useEffect(() => {
    setActionVerse(null);
  }, [bookId, chapter, translationId]);
  useEffect(() => {
    if (
      !typeMenuOpen &&
      !locationOpen &&
      !libraryOpen &&
      !translationOpen
    )
      return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        typeMenuOpen &&
        typeMenuRef.current &&
        !typeMenuRef.current.contains(target)
      ) {
        setTypeMenuOpen(false);
      }
      if (
        locationOpen &&
        locationMenuRef.current &&
        !locationMenuRef.current.contains(target)
      ) {
        setLocationOpen(false);
      }
      if (
        libraryOpen &&
        libraryRailRef.current &&
        !libraryRailRef.current.contains(target)
      ) {
        setLibraryOpen(false);
      }
      if (
        translationOpen &&
        translationMenuRef.current &&
        !translationMenuRef.current.contains(target)
      ) {
        setTranslationOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTypeMenuOpen(false);
      setLocationOpen(false);
      setLibraryOpen(false);
      setTranslationOpen(false);
      if (!query) setSearchOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [typeMenuOpen, locationOpen, libraryOpen, translationOpen, query]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (actionVerse === null) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-verse="${actionVerse}"]`)) return;
      setActionVerse(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionVerse(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [actionVerse]);
  useEffect(() => {
    if (locationReady) void load();
  }, [translationId, bookId, chapter, locationReady]);
  useEffect(() => {
    if (!initial || !verses.length) return;
    const frame = requestAnimationFrame(() =>
      readerRef.current
        ?.querySelector(`[data-verse="${initial.from}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [initial, verses]);
  useEffect(() => {
    if (targetVerse === null || !verses.length) return;
    const frame = requestAnimationFrame(() => {
      readerRef.current
        ?.querySelector(`[data-verse="${targetVerse}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTargetVerse(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [targetVerse, verses]);
  useEffect(() => {
    if (!pendingNote || !verses.length) return;
    if (
      pendingNote.bookId !== bookId ||
      pendingNote.chapter !== chapter
    )
      return;
    setEditingVerse(pendingNote.verse);
    setNoteDraft(pendingNote.note);
    setPendingNote(null);
  }, [pendingNote, verses, bookId, chapter]);
  useEffect(() => {
    localStorage.setItem(
      "bible-reader-preferences",
      JSON.stringify({
        fontSize,
        lineHeight,
        translationId,
      }),
    );
  }, [fontSize, lineHeight, translationId]);
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      api<VerseSearchResult[]>("bible:search", { query, translationId })
        .then(setResults)
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, translationId]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input,select")) return;
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  function openLocation(
    nextBook: string,
    nextChapter: number,
    nextVerse?: number,
  ) {
    setBookId(nextBook);
    setChapter(nextChapter);
    setTargetVerse(nextVerse ?? null);
    setQuery("");
    setResults([]);
    setLocationOpen(false);
    setLibraryOpen(false);
    if (nextVerse === undefined)
      window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function move(direction: number) {
    let nextChapter = chapter + direction,
      nextBook = book;
    if (nextChapter < 1) {
      const previous = books[book.order - 2];
      if (!previous) return;
      nextBook = previous;
      nextChapter = previous.chapters;
    } else if (nextChapter > book.chapters) {
      const following = books[book.order];
      if (!following) return;
      nextBook = following;
      nextChapter = 1;
    }
    openLocation(nextBook.id, nextChapter);
  }
  function highlight(verse: number, color: string | null) {
    void api("highlight:set", { bookId, chapter, verse, color }).then(() => {
      void load();
      void loadLibrary();
    });
  }
  function openNoteDrawer(item: Verse) {
    setEditingVerse(item.verse);
    setNoteDraft(item.note ?? "");
    setActionVerse(null);
    setLibraryOpen(false);
  }
  function closeNoteDrawer() {
    setEditingVerse(null);
    setNoteDraft("");
  }
  function saveNote() {
    if (editingVerse === null) return;
    void api("note:set", {
      bookId,
      chapter,
      verse: editingVerse,
      note: noteDraft,
    }).then(() => {
      void load();
      void loadLibrary();
      if (!noteDraft.trim()) closeNoteDrawer();
    });
  }
  function toggleBookmark(verse: number) {
    void api("bookmark:toggle", { bookId, chapter, verse }).then(() => {
      void load();
      void loadLibrary();
    });
  }
  async function exportNotes() {
    setNotesBusy(true);
    try {
      const result = await api<{
        canceled: boolean;
        path?: string;
        count?: number;
      }>("notes:export");
      if (result.canceled) return;
      setNotesFlash(`Exported ${result.count ?? 0} notes`);
    } catch (error) {
      setNotesFlash(error instanceof Error ? error.message : String(error));
    } finally {
      setNotesBusy(false);
    }
  }
  async function importNotes() {
    setNotesBusy(true);
    try {
      const result = await api<{
        canceled: boolean;
        count?: number;
      }>("notes:import");
      if (result.canceled) return;
      setNotesFlash(`Imported ${result.count ?? 0} notes`);
      void loadLibrary();
      void load();
    } catch (error) {
      setNotesFlash(error instanceof Error ? error.message : String(error));
    } finally {
      setNotesBusy(false);
    }
  }
  const libraryCount =
    allNotes.length + allHighlights.length + allBookmarks.length;
  const filteredHighlights = highlightFilter
    ? allHighlights.filter((item) => item.color === highlightFilter)
    : allHighlights;
  return (
    <section
      ref={readerRef}
      className={`reader${scrolled ? " is-scrolled" : ""}${editingVerse !== null && !isQuizPassage ? " has-note-drawer" : ""}`}
    >
      {back && (
        <button className="back" onClick={back}>
          <ChevronLeft /> Back to quiz
        </button>
      )}
      <div
        className={`reader-chrome${scrolled ? " is-sticky" : ""}${searchOpen || query ? " search-expanded" : ""}`}
      >
        <div className="reader-head">
          <div>
            {isQuizPassage && (
              <span className="eyebrow">QUIZ SOURCE PASSAGE</span>
            )}
            {isQuizPassage ? (
              <h1>
                {book.name} {chapter}
                {initial
                  ? `:${initial.from}${initial.to !== initial.from ? `–${initial.to}` : ""}`
                  : ""}
              </h1>
            ) : (
              <div className="location-menu" ref={locationMenuRef}>
                <button
                  type="button"
                  className={`location-title${locationOpen ? " open" : ""}`}
                  aria-expanded={locationOpen}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setTypeMenuOpen(false);
                    setLibraryOpen(false);
                    setTranslationOpen(false);
                    setLocationOpen((open) => !open);
                  }}
                >
                  <span>
                    {book.name} {chapter}
                  </span>
                  <ChevronDown size={22} />
                </button>
                {locationOpen && (
                  <div
                    className="location-panel"
                    role="dialog"
                    aria-label="Go to passage"
                  >
                    <div className="location-testaments">
                      <div className="location-testament">
                        <span>Old Testament</span>
                        <div
                          className="book-list"
                          role="listbox"
                          aria-label="Old Testament books"
                        >
                          {otBooks.map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              role="option"
                              aria-selected={bookId === item.id}
                              className={bookId === item.id ? "active" : ""}
                              onClick={() => openLocation(item.id, 1)}
                            >
                              {item.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="location-testament">
                        <span>New Testament</span>
                        <div
                          className="book-list"
                          role="listbox"
                          aria-label="New Testament books"
                        >
                          {ntBooks.map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              role="option"
                              aria-selected={bookId === item.id}
                              className={bookId === item.id ? "active" : ""}
                              onClick={() => openLocation(item.id, 1)}
                            >
                              {item.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="location-chapters">
                      <span>Chapter</span>
                      <div
                        className="chapter-grid"
                        role="listbox"
                        aria-label="Chapter"
                      >
                        {Array.from({ length: book.chapters }, (_, index) => {
                          const n = index + 1;
                          return (
                            <button
                              type="button"
                              key={n}
                              role="option"
                              aria-selected={chapter === n}
                              className={chapter === n ? "active" : ""}
                              onClick={() => {
                                setChapter(n);
                                setLocationOpen(false);
                              }}
                            >
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {!isQuizPassage && (
            <div className="reader-head-actions">
              <div className="translation-menu" ref={translationMenuRef}>
                <button
                  type="button"
                  className={`translation-chip${translationOpen ? " open" : ""}`}
                  aria-expanded={translationOpen}
                  aria-haspopup="listbox"
                  aria-label="Bible translation"
                  onClick={() => {
                    setLocationOpen(false);
                    setTypeMenuOpen(false);
                    setLibraryOpen(false);
                    setTranslationOpen((open) => !open);
                  }}
                >
                  {translation?.abbreviation ?? "BSB"}
                  <ChevronDown size={14} />
                </button>
                {translationOpen && (
                  <div className="translation-panel" role="listbox">
                    {translations.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        role="option"
                        aria-selected={translationId === item.id}
                        className={translationId === item.id ? "active" : ""}
                        onClick={() => {
                          setTranslationId(item.id);
                          setQuery("");
                          setResults([]);
                          setTranslationOpen(false);
                        }}
                      >
                        <b>{item.abbreviation}</b>
                        <small>{item.description}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="bible-search-wrap" ref={searchWrapRef}>
                {searchOpen || query ? (
                  <label className="bible-search">
                    <Search size={17} />
                    <input
                      ref={searchInputRef}
                      aria-label="Search the Bible"
                      placeholder="Words, phrases, or Psalms 3:3"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onBlur={() => {
                        if (!query.trim()) setSearchOpen(false);
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Close search"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setQuery("");
                        setResults([]);
                        setSearchOpen(false);
                      }}
                    >
                      <X size={16} />
                    </button>
                  </label>
                ) : (
                  <button
                    type="button"
                    className="search-icon-btn"
                    aria-label="Search the Bible"
                    onClick={() => {
                      setLocationOpen(false);
                      setTypeMenuOpen(false);
                      setTranslationOpen(false);
                      setLibraryOpen(false);
                      setSearchOpen(true);
                    }}
                  >
                    <Search size={18} />
                  </button>
                )}
              </div>
              <div
                className={`bookmark-menu library-menu${libraryOpen ? " is-open" : ""}`}
                ref={libraryRailRef}
              >
                <button
                  type="button"
                  className={`bookmark-icon-btn${libraryOpen ? " open" : ""}${libraryCount ? " has-marks" : ""}`}
                  aria-label="Highlights, bookmarks, and notes"
                  aria-expanded={libraryOpen}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setLocationOpen(false);
                    setTypeMenuOpen(false);
                    setTranslationOpen(false);
                    setLibraryOpen((open) => !open);
                  }}
                >
                  <Bookmark
                    size={18}
                    fill={libraryCount ? "currentColor" : "none"}
                  />
                  {libraryCount > 0 && (
                    <span className="bookmark-badge">
                      {libraryCount > 99 ? "99+" : libraryCount}
                    </span>
                  )}
                </button>
                {libraryOpen && (
                  <div
                    className="bookmark-manage-panel library-panel"
                    role="dialog"
                    aria-label="Your Bible annotations"
                  >
                    <p>
                      Browse verse highlights, bookmarks, and notes. Tap a
                      verse in the text to highlight, bookmark, or note it.
                    </p>
                    <div className="library-tabs" role="tablist">
                      {(
                        [
                          ["highlights", `Highlights (${allHighlights.length})`],
                          ["bookmarks", `Bookmarks (${allBookmarks.length})`],
                          ["notes", `Notes (${allNotes.length})`],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          type="button"
                          role="tab"
                          key={id}
                          aria-selected={libraryTab === id}
                          className={libraryTab === id ? "active" : ""}
                          onClick={() => setLibraryTab(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {libraryTab === "highlights" && (
                      <>
                        <div className="library-filters">
                          <button
                            type="button"
                            className={!highlightFilter ? "active" : ""}
                            onClick={() => setHighlightFilter(null)}
                          >
                            All
                          </button>
                          {colors.map((color) => (
                            <button
                              type="button"
                              key={color}
                              className={`swatch-filter swatch-${color}${highlightFilter === color ? " active" : ""}`}
                              aria-label={`Filter ${color} highlights`}
                              aria-pressed={highlightFilter === color}
                              onClick={() =>
                                setHighlightFilter(
                                  highlightFilter === color ? null : color,
                                )
                              }
                            />
                          ))}
                        </div>
                        {filteredHighlights.length === 0 ? (
                          <p className="notes-empty">
                            No highlights yet. Tap a verse, then pick a color.
                          </p>
                        ) : (
                          <div className="notes-list">
                            {filteredHighlights.map((item) => (
                              <button
                                type="button"
                                key={`${item.bookId}-${item.chapter}-${item.verse}-${item.color}`}
                                className="notes-list-item"
                                onClick={() =>
                                  openLocation(
                                    item.bookId,
                                    item.chapter,
                                    item.verse,
                                  )
                                }
                              >
                                <strong>
                                  <span
                                    className={`swatch swatch-${item.color} inline`}
                                    aria-hidden
                                  />
                                  {item.bookName} {item.chapter}:{item.verse}
                                </strong>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {libraryTab === "bookmarks" &&
                      (allBookmarks.length === 0 ? (
                        <p className="notes-empty">
                          No bookmarks yet. Tap a verse, then the bookmark
                          icon.
                        </p>
                      ) : (
                        <div className="notes-list">
                          {allBookmarks.map((item) => (
                            <button
                              type="button"
                              key={`${item.bookId}-${item.chapter}-${item.verse}`}
                              className="notes-list-item"
                              onClick={() =>
                                openLocation(
                                  item.bookId,
                                  item.chapter,
                                  item.verse,
                                )
                              }
                            >
                              <strong>
                                <Bookmark size={13} fill="currentColor" />{" "}
                                {item.bookName} {item.chapter}:{item.verse}
                              </strong>
                            </button>
                          ))}
                        </div>
                      ))}
                    {libraryTab === "notes" && (
                      <>
                        <div className="notes-panel-actions">
                          <button
                            type="button"
                            className="secondary"
                            disabled={notesBusy}
                            onClick={() => void exportNotes()}
                          >
                            <Download size={14} /> Export
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={notesBusy}
                            onClick={() => void importNotes()}
                          >
                            <Upload size={14} /> Import
                          </button>
                        </div>
                        {notesFlash && (
                          <p className="notes-flash" role="status">
                            {notesFlash}
                          </p>
                        )}
                        {allNotes.length === 0 ? (
                          <p className="notes-empty">
                            No notes yet. Tap a verse, then the note icon.
                          </p>
                        ) : (
                          <div className="notes-list">
                            {allNotes.map((item) => (
                              <button
                                type="button"
                                key={`${item.bookId}-${item.chapter}-${item.verse}`}
                                className="notes-list-item"
                                onClick={() => {
                                  setPendingNote({
                                    bookId: item.bookId,
                                    chapter: item.chapter,
                                    verse: item.verse,
                                    note: item.note,
                                  });
                                  openLocation(
                                    item.bookId,
                                    item.chapter,
                                    item.verse,
                                  );
                                }}
                              >
                                <strong>
                                  {item.bookName} {item.chapter}:{item.verse}
                                </strong>
                                <span>{item.note}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="text-controls" ref={typeMenuRef}>
                <button
                  type="button"
                  className={`type-menu-trigger${typeMenuOpen ? " open" : ""}`}
                  aria-label="Text size and spacing"
                  aria-expanded={typeMenuOpen}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setLocationOpen(false);
                    setTranslationOpen(false);
                    setLibraryOpen(false);
                    setTypeMenuOpen((open) => !open);
                  }}
                >
                  Aa
                </button>
                {typeMenuOpen && (
                  <div
                    className="type-menu-panel"
                    role="dialog"
                    aria-label="Reading appearance"
                  >
                    <div className="type-menu-row">
                      <button
                        type="button"
                        aria-label="Decrease text size"
                        onClick={() => setFontSize(Math.max(16, fontSize - 1))}
                      >
                        <Minus size={16} />
                      </button>
                      <span>Text {fontSize}</span>
                      <button
                        type="button"
                        aria-label="Increase text size"
                        onClick={() => setFontSize(Math.min(32, fontSize + 1))}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <div className="type-menu-group">
                      <span>Spacing</span>
                      <div className="type-menu-chips">
                        {(
                          [
                            [1.6, "Compact"],
                            [1.9, "Comfortable"],
                            [2.2, "Spacious"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            type="button"
                            key={value}
                            className={lineHeight === value ? "active" : ""}
                            onClick={() => setLineHeight(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="type-menu-hint">
                      Light and dark follow app Settings → Appearance.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {query ? (
        <div className="search-results card">
          <b>
            {searching
              ? "Searching…"
              : `${results.length}${results.length === 100 ? "+" : ""} results`}
          </b>
          {!searching && results.length === 0 && (
            <p>No verses found. Try another word, phrase, or reference.</p>
          )}
          {results.map((result) => (
            <button
              key={`${result.bookId}-${result.chapter}-${result.verse}`}
              onClick={() =>
                openLocation(result.bookId, result.chapter, result.verse)
              }
            >
              <strong>
                {result.bookName} {result.chapter}:{result.verse}
              </strong>
              <span>{result.text}</span>
            </button>
          ))}
        </div>
      ) : verses.length ? (
        <article className="scripture" style={{ fontSize, lineHeight }}>
          {verses.map((item) => {
            const open = actionVerse === item.verse;
            return (
              <p
                data-verse={item.verse}
                className={[
                  "verse-row",
                  open ? "verse-open" : "",
                  initial &&
                  item.verse >= initial.from &&
                  item.verse <= initial.to
                    ? "temporary"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.verse}
                onClick={() => {
                  if (isQuizPassage) return;
                  setActionVerse(open ? null : item.verse);
                }}
              >
                <sup>{item.verse}</sup>
                <span
                  className="verse-text"
                  style={
                    item.highlightColor
                      ? {
                          background: `var(--highlight-${item.highlightColor})`,
                        }
                      : undefined
                  }
                >
                  {item.text}
                </span>
                {!isQuizPassage && (item.bookmarked || item.note) && (
                  <span className="verse-markers" aria-hidden={false}>
                    {item.bookmarked && (
                      <span
                        className="verse-marker bookmarked"
                        title="Bookmarked"
                      >
                        <Bookmark size={12} fill="currentColor" />
                      </span>
                    )}
                    {item.note && (
                      <button
                        type="button"
                        className={`verse-marker has-note${editingVerse === item.verse ? " active" : ""}`}
                        aria-label={`Open note for verse ${item.verse}`}
                        title="Open note"
                        onClick={(event) => {
                          event.stopPropagation();
                          openNoteDrawer(item);
                        }}
                      >
                        <StickyNote size={12} />
                      </button>
                    )}
                  </span>
                )}
                {!isQuizPassage && open && (
                  <span
                    className="highlights"
                    role="toolbar"
                    aria-label={`Actions for verse ${item.verse}`}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <span className="highlights-swatches">
                      {colors.map((color) => (
                        <button
                          type="button"
                          aria-label={`Highlight verse ${item.verse} ${color}`}
                          aria-pressed={item.highlightColor === color}
                          title={color}
                          className={`swatch swatch-${color}${item.highlightColor === color ? " active" : ""}`}
                          onClick={() => highlight(item.verse, color)}
                          key={color}
                        />
                      ))}
                    </span>
                    <span className="highlights-divider" aria-hidden />
                    <button
                      type="button"
                      className="highlights-action"
                      aria-label={`Remove highlight from verse ${item.verse}`}
                      title="Clear highlight"
                      disabled={!item.highlightColor}
                      onClick={() => highlight(item.verse, null)}
                    >
                      <Eraser size={14} />
                    </button>
                    <button
                      type="button"
                      className={`highlights-action${item.bookmarked ? " annotation-active" : ""}`}
                      aria-label={
                        item.bookmarked
                          ? `Remove bookmark from verse ${item.verse}`
                          : `Bookmark verse ${item.verse}`
                      }
                      title={item.bookmarked ? "Remove bookmark" : "Bookmark"}
                      onClick={() => toggleBookmark(item.verse)}
                    >
                      <Bookmark
                        size={14}
                        fill={item.bookmarked ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      type="button"
                      className="highlights-action"
                      aria-label={`Share verse ${item.verse}`}
                      title="Share verse"
                      onClick={() =>
                        void shareVerse(
                          `${book.name} ${chapter}:${item.verse}`,
                          item.text,
                        )
                      }
                    >
                      <Share2 size={14} />
                    </button>
                    <button
                      type="button"
                      className={`highlights-action${item.note ? " annotation-active" : ""}`}
                      aria-label={`Add note to verse ${item.verse}`}
                      title="Personal note"
                      onClick={() => openNoteDrawer(item)}
                    >
                      <StickyNote size={14} />
                    </button>
                  </span>
                )}
              </p>
            );
          })}
        </article>
      ) : (
        <div className="empty card">
          <BookOpen />
          <h3>Chapter unavailable</h3>
          <p>
            {loadError ||
              "The local Bible content could not provide this chapter."}
          </p>
        </div>
      )}
      {editingVerse !== null && !isQuizPassage && (
        <aside className="note-drawer" aria-label="Verse note">
          <header className="note-drawer-head">
            <div>
              <span className="eyebrow">NOTE</span>
              <b>
                {book.name} {chapter}:{editingVerse}
              </b>
            </div>
            <button
              type="button"
              className="note-drawer-close"
              aria-label="Close note"
              onClick={closeNoteDrawer}
            >
              <X size={16} />
            </button>
          </header>
          <textarea
            autoFocus
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Write a private note saved only to this profile…"
          />
          <div className="note-drawer-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setNoteDraft("")}
            >
              Clear
            </button>
            <button type="button" className="primary" onClick={saveNote}>
              Save note
            </button>
          </div>
        </aside>
      )}
      {!query && !isQuizPassage && (
        <div className="chapter-nav">
          <button type="button" onClick={() => move(-1)}>
            <ChevronLeft /> Previous chapter
          </button>
          <button type="button" onClick={() => move(1)}>
            Next chapter <ChevronRight />
          </button>
        </div>
      )}
      <p className="translation-note">
        {translation?.name ?? "Berean Standard Bible"},{" "}
        {translation?.license ?? "Public Domain"}. Bible text is stored locally
        and works without an internet connection.
      </p>
    </section>
  );
}
