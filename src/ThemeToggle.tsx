import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "./theme";

const OPTIONS: {
	id: ThemePreference;
	label: string;
	Icon: typeof Sun;
}[] = [
	{ id: "system", label: "System", Icon: Monitor },
	{ id: "light", label: "Light", Icon: Sun },
	{ id: "dark", label: "Dark", Icon: Moon },
];

const NEXT: Record<ThemePreference, ThemePreference> = {
	system: "light",
	light: "dark",
	dark: "system",
};

export default function ThemeToggle({
	value,
	onChange,
	className = "",
	compact = false,
}: {
	value: ThemePreference;
	onChange: (next: ThemePreference) => void;
	className?: string;
	compact?: boolean;
}) {
	if (compact) {
		const current = OPTIONS.find((o) => o.id === value) ?? OPTIONS[0]!;
		const upcoming = NEXT[value];
		const Icon = current.Icon;
		return (
			<button
				type="button"
				className={`header-icon theme-cycle ${className}`.trim()}
				aria-label={`Appearance: ${current.label}. Click for ${OPTIONS.find((o) => o.id === upcoming)?.label}`}
				title={`${current.label} · click to change`}
				onClick={() => onChange(upcoming)}
			>
				<Icon size={18} />
			</button>
		);
	}
	return (
		<div
			className={`theme-toggle ${className}`.trim()}
			role="group"
			aria-label="Appearance"
		>
			{OPTIONS.map(({ id, label, Icon }) => (
				<button
					key={id}
					type="button"
					className={value === id ? "active" : ""}
					aria-pressed={value === id}
					aria-label={label}
					title={label}
					onClick={() => onChange(id)}
				>
					<Icon size={15} />
				</button>
			))}
		</div>
	);
}
