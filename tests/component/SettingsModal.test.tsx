import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsModal from '@/widgets/settings/SettingsModal';
import { I18nProvider } from '@/shared/i18n';

describe('SettingsModal', () => {
  it('keeps connection values editable and exposes the persisted locale control', () => {
    const onSave = vi.fn();
    const onLocaleChange = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><SettingsModal initialApiKey="old-key" initialBaseUrl="https://api.test/v1" initialModel="model-a" locale="zh-CN" onLocaleChange={onLocaleChange} onSave={onSave} onClose={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('heading', { name: '配置' })).toBeInTheDocument();
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'https://new.test/v1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    expect(onSave).toHaveBeenCalledWith('old-key', 'https://new.test/v1', 'model-a');
    fireEvent.change(screen.getByDisplayValue('zh-CN'), { target: { value: 'en-US' } });
    expect(onLocaleChange).toHaveBeenCalledWith('en-US');
  });
});
