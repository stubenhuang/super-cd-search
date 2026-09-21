import { useState } from 'react'
import { PublishTargetsSection } from './Publish'
import { useI18n } from './i18n'
import './Settings.css'

interface PublishTargetsPanelProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * 发布目标管理面板（从设置里独立出来的常驻入口）。
 *
 * 结构与 LanPanel 一致：设置风格的模态、无侧边栏，滚动区直接渲染
 * PublishTargetsSection。目标的新增/编辑/删除在 section 内部即时持久化，
 * 所以底部没有「保存」按钮，只有「关闭」。
 */
export function PublishTargetsPanel({ isOpen, onClose }: PublishTargetsPanelProps) {
  const { t } = useI18n()
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  if (!isOpen) return null

  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    setToast({ kind, text })
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel publish-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-targets-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="settings-main">
          <div className="settings-content-header">
            <h3 id="publish-targets-title">{t('nav.publish')}</h3>
            <span className="st-section-badge">{t('settings.badge')}</span>
          </div>
          <div className="settings-scroll">
            <PublishTargetsSection onToast={showToast} />
          </div>
          <footer className="settings-footer">
            <span className="st-footer-hint">{t('settings.publishFooterHint')}</span>
            <div className="st-footer-actions">
              <button className="st-btn-cancel" onClick={onClose}>{t('settings.close')}</button>
            </div>
          </footer>
        </div>
        {toast && (
          <div role="status" aria-live="polite" className={`st-toast ${toast.kind === 'error' ? 'error' : ''}`}>
            {toast.text}
          </div>
        )}
      </div>
    </div>
  )
}
