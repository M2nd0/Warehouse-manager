import type { ComponentChildren } from 'preact';

/** Small building blocks shared by the panels. */

export type Tone = 'good' | 'warn' | 'bad' | 'plain';

export function Section({ title, aside, children }: { title: string; aside?: string; children: ComponentChildren }) {
  return (
    <section class="section">
      <h3 class="section__title">
        <span>{title}</span>
        {aside !== undefined && <span class="section__aside">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

/** A headline number with its label. */
export function Stat({ label, value, tone = 'plain' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div class="stat">
      <span class={`stat__value tone-${tone}`}>{value}</span>
      <span class="stat__label">{label}</span>
    </div>
  );
}

/** A label with its value on one line. */
export function Field({ label, value, tone = 'plain' }: { label: string; value: ComponentChildren; tone?: Tone }) {
  return (
    <div class="field">
      <span class="field__label">{label}</span>
      <span class={`field__value tone-${tone}`}>{value}</span>
    </div>
  );
}

/** A thin bar filled to `value` (0–1). */
export function Bar({ value, tone = 'plain', label }: { value: number; tone?: Tone; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span class="bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span class={`bar__fill tone-bg-${tone}`} style={{ width: `${percent}%` }} />
    </span>
  );
}

/** A 1–5 rating as five pips. */
export function Pips({ value, label }: { value: number; label: string }) {
  return (
    <span class="pips" role="img" aria-label={`${label}: ${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} class={`pips__pip ${n <= value ? 'pips__pip--on' : ''}`} />
      ))}
    </span>
  );
}

export function Badge({ text, tone = 'plain' }: { text: string; tone?: Tone }) {
  return <span class={`badge tone-badge-${tone}`}>{text}</span>;
}

export const Empty = ({ text }: { text: string }) => <p class="empty">{text}</p>;
