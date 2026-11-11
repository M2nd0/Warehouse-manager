import { balance } from '../data/balance';
import { t } from '../data/i18n';
import type { AisleRating } from '../sim';
import type { UiActions } from './controller';
import { formatMoney } from './format';
import type { BuildHint, Tool, UiState } from './store';

const RATING_TONE: Record<AisleRating, string> = {
  ok: 'tone-good',
  tight: 'tone-warn',
  narrow: 'tone-bad',
  none: 'tone-dim',
};

/** What the building tool says about the spot under the cursor. */
function HintLine({ hint }: { hint: BuildHint | null }) {
  if (!hint) return <span>{t('build.hint')}</span>;
  if (hint.error) return <span class="tone-bad">{t(`build.error.${hint.error}`)}</span>;
  return (
    <span>
      {t('build.aisles')}{' '}
      {hint.aisles.map((aisle, i) => (
        <span key={i} class={RATING_TONE[aisle.rating]}>
          {i > 0 && <span class="tone-dim"> · </span>}
          {aisle.rating === 'none' ? t('build.aisle.none') : t(`build.aisle.${aisle.rating}`, { width: aisle.width })}
        </span>
      ))}
      {hint.unserved > 0 && <span class="tone-warn"> · {t('build.unserved', { count: hint.unserved })}</span>}
    </span>
  );
}

/** Bottom bar: the tools for laying out the hall. */
export function Toolbar({ ui, actions }: { ui: UiState; actions: UiActions }) {
  const tool = (id: Tool, label: string, key: string, detail?: string) => (
    <button
      type="button"
      class={`tool ${ui.tool === id ? 'tool--active' : ''}`}
      aria-pressed={ui.tool === id}
      data-testid={`tool-${id}`}
      onClick={() => actions.setTool(id)}
    >
      <span class="tool__label">{label}</span>
      {detail && <span class="tool__detail">{detail}</span>}
      <kbd class="tool__key">{key}</kbd>
    </button>
  );
  return (
    <div class="toolbar-wrap">
      {ui.tool !== 'select' ? (
        <div class="toolhint" data-testid="tool-hint">
          {ui.tool === 'rack' ? <HintLine hint={ui.hint} /> : <span>{t('demolish.hint')}</span>}
        </div>
      ) : (
        ui.insight !== 'none' && (
          <div class="toolhint" data-testid="insight-legend">
            {t(`insight.legend.${ui.insight}`)}
          </div>
        )
      )}
      <nav class="toolbar" aria-label={t('toolbar.label')}>
        {tool('select', t('tool.select'), 'Esc')}
        {tool('rack', t('tool.rack'), 'B', formatMoney(balance.rack.price, 0))}
        {tool('demolish', t('tool.demolish'), 'X')}
        <span class="toolbar__divider" />
        {ui.tool === 'rack' && (
          <button type="button" class="tool" data-testid="tool-rotate" onClick={actions.rotate}>
            <span class="tool__label">{t('tool.rotate')}</span>
            <kbd class="tool__key">R</kbd>
          </button>
        )}
        <button
          type="button"
          class={`tool ${ui.topDown ? 'tool--active' : ''}`}
          aria-pressed={ui.topDown}
          data-testid="tool-topdown"
          onClick={actions.toggleTopDown}
        >
          <span class="tool__label">{t('tool.topDown')}</span>
          <kbd class="tool__key">T</kbd>
        </button>
        <button
          type="button"
          class={`tool ${ui.insight !== 'none' ? 'tool--active' : ''}`}
          aria-pressed={ui.insight !== 'none'}
          data-testid="tool-insight"
          data-mode={ui.insight}
          onClick={actions.cycleInsight}
        >
          <span class="tool__label">{t(`insight.${ui.insight}`)}</span>
          <kbd class="tool__key">O</kbd>
        </button>
      </nav>
    </div>
  );
}
