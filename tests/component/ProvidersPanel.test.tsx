import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import { ProvidersPanel } from '@/features/settings/panels/ProvidersPanel';
import type { AppConfig } from '@/features/settings/useAppConfig';
import type { ProviderConfig } from '@/shared/config/providers';

afterEach(() => cleanup());

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    settings: null,
    providers: [],
    personas: [],
    activeProviderId: null,
    globalModel: '',
    activePersonaId: null,
    addProvider: vi.fn(),
    updateProvider: vi.fn(),
    removeProvider: vi.fn(),
    selectGlobalModel: vi.fn(),
    addPersona: vi.fn(),
    updatePersona: vi.fn(),
    removePersona: vi.fn(),
    selectPersona: vi.fn(),
    ...overrides,
  } as unknown as AppConfig;
}

const anthropicProvider: ProviderConfig = {
  id: 'prov-1', presetId: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-...', defaultModel: 'claude-sonnet-4-5', api: 'anthropic-messages', createdAt: 1, updatedAt: 1,
};

describe('ProvidersPanel api propagation (M2)', () => {
  it('propagates the anthropic preset api to the created provider', () => {
    const addProvider = vi.fn();
    render(<I18nProvider><ProvidersPanel config={createConfig({ addProvider })} /></I18nProvider>);

    fireEvent.click(screen.getByRole('button', { name: '添加供应商' }));
    // 选 Anthropic 预设 → handlePresetChange 把 preset.api 一并写入表单 state。
    fireEvent.change(screen.getByLabelText('供应商类型'), { target: { value: 'anthropic' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Anthropic' } });
    fireEvent.change(screen.getByLabelText('接口地址 (OpenAI Compatible)'), { target: { value: 'https://api.anthropic.com' } });
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'sk-...' } });
    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: 'claude-sonnet-4-5' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));

    expect(addProvider).toHaveBeenCalledTimes(1);
    const input = addProvider.mock.calls[0]![0] as { api?: string; presetId?: string };
    expect(input.api).toBe('anthropic-messages');
    expect(input.presetId).toBe('anthropic');
  });

  it('keeps the provider api when editing an existing anthropic provider', () => {
    const updateProvider = vi.fn();
    render(<I18nProvider><ProvidersPanel config={createConfig({ providers: [anthropicProvider], activeProviderId: 'prov-1', updateProvider })} /></I18nProvider>);

    fireEvent.click(screen.getByTitle('编辑'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Anthropic Pro' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));

    expect(updateProvider).toHaveBeenCalledTimes(1);
    const updated = updateProvider.mock.calls[0]![0] as ProviderConfig;
    expect(updated.api).toBe('anthropic-messages');
  });
});
