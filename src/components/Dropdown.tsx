import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface DropdownOption<V extends string> {
  /** Value persisted into state. */
  value: V;
  /** Visible label for trigger + menu rows. */
  label: string;
  /** Optional leading element (a `<ProviderLogo>` for the model dropdown). */
  leading?: ReactNode;
}

interface DropdownProps<V extends string> {
  value: V;
  options: ReadonlyArray<DropdownOption<V>>;
  onChange: (value: V) => void;
  /** Optional minimum width for the trigger button. */
  minWidth?: number;
  /**
   * Optional custom label render for the trigger. By default the selected
   * option's `label` is rendered. Used by the model dropdown to show
   * "Provider — model" with the leading logo.
   */
  renderTriggerLabel?: (option: DropdownOption<V>) => ReactNode;
  className?: string;
}

/**
 * Custom dropdown that mirrors the design's `.dropdown` pattern. Trigger
 * is an inline button; the menu opens as a floating `position: fixed` panel
 * anchored to the trigger and flips above when there isn't room below.
 *
 * Replaces the native `<select>` everywhere settings show a provider/model
 * or plain text choice.
 */
export function Dropdown<V extends string>({
  value,
  options,
  onChange,
  minWidth,
  renderTriggerLabel,
  className,
}: DropdownProps<V>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; minWidth: number } | null>(
    null,
  );

  const selected = options.find((option) => option.value === value) ?? options[0];

  const closeOnOutside = useCallback((event: MouseEvent) => {
    const target = event.target as Node;
    if (
      triggerRef.current?.contains(target) ||
      menuRef.current?.contains(target)
    ) {
      return;
    }
    setOpen(false);
  }, []);

  const closeOnEsc = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEsc);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEsc);
    };
  }, [open, closeOnOutside, closeOnEsc]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;
    const spaceBelow = window.innerHeight - trigger.bottom;
    const openUp = spaceBelow < menuHeight + 16 && trigger.top > menuHeight + 16;
    setMenuStyle({
      left: trigger.left,
      top: openUp ? trigger.top - menuHeight - 4 : trigger.bottom + 4,
      minWidth: trigger.width,
    });
  }, [open]);

  const select = (next: V) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className={`dropdown ${open ? "open" : ""} ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        style={minWidth ? { minWidth } : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        {renderTriggerLabel ? (
          renderTriggerLabel(selected)
        ) : (
          <>
            {selected.leading}
            <span className="dropdown-label">{selected.label}</span>
          </>
        )}
        <ChevronDown className="dropdown-chev" strokeWidth={1.6} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="dropdown-menu"
          style={menuStyle ?? { left: -9999, top: -9999, minWidth: 200 }}
        >
          {options.map((option) => (
            <div
              key={option.value}
              className={`dropdown-option ${option.value === value ? "selected" : ""}`}
              onClick={() => select(option.value)}
            >
              {option.leading}
              <span>{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 16×16 provider logo used in the model dropdown.
 * Renders the real brand mark from `/public/provider-icons/*.png` when one
 * exists, with a transparent background. Falls back to a colored glyph chip
 * for providers without an asset.
 */
export function ProviderLogo({ provider }: { provider: string }) {
  const asset = PROVIDER_ASSET[provider];
  if (asset) {
    return (
      <img
        src={asset}
        alt=""
        aria-hidden="true"
        className="provider-logo"
        style={{ background: "transparent", objectFit: "contain" }}
      />
    );
  }
  const meta = PROVIDER_GLYPH[provider] ?? { bg: "#3a3a3a", glyph: provider.slice(0, 1) };
  return (
    <span className="provider-logo" style={{ background: meta.bg }} aria-hidden="true">
      {meta.glyph}
    </span>
  );
}

const PROVIDER_ASSET: Record<string, string> = {
  OpenAI: "/provider-icons/openai_logo.svg",
  Google: "/provider-icons/gemini.png",
  Apple: "/provider-icons/apple.svg",
  Deepgram: "/provider-icons/deepgram.png",
  Groq: "/provider-icons/groq.png",
  NVIDIA: "/provider-icons/nvidia.png",
  Alibaba: "/provider-icons/qwen.png",
};

// Fallback colored chip with brand glyph — used for providers that don't
// have an asset shipped. Empty by default; every shipped provider has an
// icon in `PROVIDER_ASSET`.
const PROVIDER_GLYPH: Record<string, { bg: string; glyph: string }> = {};
