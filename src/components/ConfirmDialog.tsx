import { useEffect, useRef } from "react";

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

	useEffect(() => {
		if (!open) return undefined;
		// Defer focus past the click that opened us so the browser doesn't
		// collapse it back to the triggering button.
		const t = window.setTimeout(() => confirmRef.current?.focus(), 0);
		return () => window.clearTimeout(t);
	}, [open]);

	useEffect(() => {
		if (!open) return undefined;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onCancel();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onCancel]);

	if (!open) return null;

	return (
		<div
			className="confirm-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-dialog-title"
		>
			<div className="confirm-card">
				<h2 id="confirm-dialog-title" className="confirm-title">
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
