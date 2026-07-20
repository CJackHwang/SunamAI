import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from '@/shared/i18n';
import { STORAGE_KEYS } from '@/shared/lib/storage';

function Greeting() {
  const { locale, t } = useI18n();
  return <div>{locale}:{t('common.loading')}</div>;
}

describe('I18nProvider', () => {
  beforeEach(() => localStorage.clear());
  it('uses the persisted non-Chinese catalogue on the first render', () => {
    localStorage.setItem(STORAGE_KEYS.locale, 'ja-JP');
    render(<I18nProvider><Greeting /></I18nProvider>);
    expect(screen.getByText('ja-JP:読み込み中...')).toBeInTheDocument();
    expect(screen.queryByText(/加载中/)).not.toBeInTheDocument();
  });
});
