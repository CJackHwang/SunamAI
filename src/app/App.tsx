import React from 'react';
import MainPage from '../pages/MainPage.tsx';
import { I18nProvider } from '@/shared/i18n';
import { AppUpdateNotice } from '@/shared/ui/AppUpdateNotice';
import { BeforeUnloadGuard } from '@/shared/ui/BeforeUnloadGuard';

const App: React.FC = () => {
  return (
    <I18nProvider>
      <BeforeUnloadGuard />
      <MainPage />
      <AppUpdateNotice />
    </I18nProvider>
  );
};

export default App;
