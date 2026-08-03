import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/shared/i18n';
import { Sidebar } from '@/widgets/sidebar/Sidebar';

afterEach(() => cleanup());

describe('Sidebar container availability', () => {
  it('hides the containers section when the container capability is unavailable', async () => {
    render(<I18nProvider><Sidebar containerAvailable={false} /></I18nProvider>);
    expect(screen.queryByText('容器')).not.toBeInTheDocument();
  });

  it('shows the containers section when the container capability is available', async () => {
    render(<I18nProvider><Sidebar containerAvailable={true} /></I18nProvider>);
    expect(await screen.findByText('容器')).toBeInTheDocument();
  });
});
