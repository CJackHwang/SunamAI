import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SettingsModal from '@/widgets/settings/SettingsModal';
import { I18nProvider } from '@/shared/i18n';

describe('SettingsModal', () => {
  it('keeps connection values editable and exposes the persisted locale control', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onLocaleChange = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><SettingsModal initialApiKey="old-key" initialBaseUrl="https://api.test/v1" initialModel="model-a" locale="zh-CN" onLocaleChange={onLocaleChange} onSave={onSave} onClose={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('heading', { name: '配置' })).toBeInTheDocument();
    const inputs = screen.getAllByRole('textbox');
    await user.clear(inputs[0]);
    await user.type(inputs[0], 'https://new.test/v1');
    await user.click(screen.getByRole('button', { name: '保存并继续' }));
    expect(onSave).toHaveBeenCalledWith('old-key', 'https://new.test/v1', 'model-a');
    await user.selectOptions(screen.getByDisplayValue('zh-CN'), 'en-US');
    expect(onLocaleChange).toHaveBeenCalledWith('en-US');
  });
});
