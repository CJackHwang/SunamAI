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
    expect(screen.getByText('所有配置信息仅保存在当前设备本地。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('接口地址 (OpenAI Compatible)'), { target: { value: 'https://new.test/v1' } });
    expect(screen.getByLabelText('API 密钥')).toHaveValue('old-key');
    expect(screen.getByLabelText('模型')).toHaveValue('model-a');
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    expect(onSave).toHaveBeenCalledWith('old-key', 'https://new.test/v1', 'model-a');
    fireEvent.change(screen.getByLabelText('语言'), { target: { value: 'en-US' } });
    expect(onLocaleChange).toHaveBeenCalledWith('en-US');
  });
});
