import type { ReactNode } from "react";

const ZONES = Intl.supportedValuesOf("timeZone");

/** Free-text time zone with suggestions (IANA names such as Asia/Dubai or Europe/London). */
export function TimezoneInput({ name = "timezone", defaultValue, id = "timezone" }: { name?: string; defaultValue?: string; id?: string }) {
  return (
    <>
      <input id={id} name={name} list={`${id}-zones`} className="input" defaultValue={defaultValue} placeholder="e.g. Asia/Dubai" autoComplete="off" />
      <datalist id={`${id}-zones`}>
        {ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}
