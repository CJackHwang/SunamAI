import { Code2, Link2, ScrollText } from 'lucide-react';
import { useI18n } from '@/shared/i18n';

/**
 * R6：关于栏目。布局参考 HeyMean AboutPage：头像 + 标题 + 描述 + 开发者 + GitHub/License
 * 按钮（简洁卡片式）。附 Succinix 项目链接（用户明确要求）+ AGPL 许可证。
 */
export function AboutPanel() {
  const { t } = useI18n();

  const openLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="settings-panel settings-about">
      <div className="settings-about-card">
        <img
          src="https://avatars.githubusercontent.com/u/155826701"
          alt={t('about.developedBy')}
          className="settings-about-avatar"
        />
        <h2 className="settings-about-name">Sunam</h2>
        <p className="settings-about-description">{t('about.description')}</p>
        <p className="settings-about-developer">{t('about.developedBy')}</p>
        <div className="settings-about-actions">
          <button className="btn btn-secondary settings-about-btn" onClick={() => openLink('https://github.com/CJackHwang/SunamAI')}>
            <Code2 size={18} />
            <span>{t('about.githubRepo')}</span>
          </button>
          <button className="btn btn-secondary settings-about-btn" onClick={() => openLink('https://www.gnu.org/licenses/agpl-3.0.html')}>
            <ScrollText size={18} />
            <span>{t('about.license')}</span>
          </button>
          <button className="btn btn-secondary settings-about-btn" onClick={() => openLink('https://github.com/CJackHwang/Succinix')}>
            <Link2 size={18} />
            <span>{t('about.succinix')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
