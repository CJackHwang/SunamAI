import React from 'react';
import MainPage from '../pages/MainPage.tsx';
import { I18nProvider } from '@/shared/i18n';

const App: React.FC = () => {
  return (
    <I18nProvider>
      <MainPage />
    </I18nProvider>
  );
};

export default App;
