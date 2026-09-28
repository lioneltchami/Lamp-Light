import { useEffect, useId, useRef } from "react";

export type ConfirmDialogProps = {
	open: boolean;
	title: string;
	body?: React.ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	/**
	 * Hide the cancel button (single-button "OK" style).
	 * Escape still dismisses.
	 */
	hideCancel?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

const FOCUSABLE = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

export function ConfirmDialog({
	open,
	title,
	body,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	hideCancel = false,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const confirmRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	// A page can mount several ConfirmDialogs at once, so the title id has to be
	// instance-unique or aria-labelledby points at the wrong element.
	const titleId = useId();

	useEffect(() => {
		if (!open) return undefined;
		const previouslyFocused = document.activeElement as HTMLElement | null;
		// Defer focus past the click that opened us so the browser doesn't
		// collapse it back to the triggering button.
		const t = window.setTimeout(() => confirmRef.current?.focus(), 0);
		const onKey = (e: KeyboardEvent) => {
			// Capture phase plus stopPropagation: a modal dialog owns Escape, and
			// anything else listening on the page (Reader's popover dismisser, for
			// one) must not also react to it.
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onCancel();
				return;
			}
			if (e.key !== "Tab") return;
			// Trap Tab inside the dialog. Without this it walks straight out into
			// the page the modal is supposed to be hiding.
			const root = dialogRef.current;
			if (!root) return;
			const focusable = Array.from(
				root.querySelectorAll<HTMLElement>(FOCUSABLE),
			).filter((el) => el.getClientRects().length > 0);
			if (focusable.length === 0) {
				e.preventDefault();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (e.shiftKey) {
				if (active === first || !root.contains(active)) {
					e.preventDefault();
					last.focus();
				}
			} else if (active === last || !root.contains(active)) {
				e.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener("keydown", onKey, true);
			// Hand focus back to whatever opened us, but only if it is still on
			// screen - a page change may have replaced it.
			if (previouslyFocused && document.contains(previouslyFocused)) {
				previouslyFocused.focus();
			}
		};
	}, [open, onCancel]);

	if (!open) return null;

	return (
		<div
			className="confirm-overlay"
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
		>
			<div className="confirm-card">
				<h2 id={titleId} className="confirm-title">
					{title}
				</h2>
				{body !== undefined && body !== null && body !== false && (
					<div className="confirm-body">{body}</div>
				)}
				<div className="confirm-actions">
					{!hideCancel && (
						<button type="button" className="secondary" onClick={onCancel}>
							{cancelLabel}
						</button>
					)}
					<button
						ref={confirmRef}
						type="button"
						className={destructive ? "danger" : "primary"}
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
