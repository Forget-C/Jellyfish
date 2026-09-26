import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const NotFound: React.FC = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('notFound')

  return (
    <Result
      status="404"
      /* 审计 §4.7-R27 / §5.5-A2：`title="404"` 是硬编码的机器状态码，
         对用户没有意义 → 改「页面不存在」。中文文案仍走 `notFound` 命名空间
         （`locales/zh-CN/notFound.json` 里本来就有，整页显示英文的唯一原因是
         初始语言被 `LanguageDetector` 解析成 `en-US`，已在 `src/i18n.ts` 修掉）。 */
      title="页面不存在"
      subTitle={t('subTitle')}
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          {t('backHome')}
        </Button>
      }
    />
  )
}

export default NotFound

