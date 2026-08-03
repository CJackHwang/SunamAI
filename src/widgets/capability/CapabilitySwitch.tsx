interface CapabilitySwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** Apple-style accessibility switch. Thumb is always white; on-state uses the accent color. */
export function CapabilitySwitch({ checked, onChange, label, disabled = false, title }: CapabilitySwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onChange(!checked); }}
      className={`capability-switch${checked ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <span className="capability-switch-thumb" />
    </button>
  );
}
