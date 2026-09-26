import { Card, Form, Input, Select, Switch, Button, message } from 'antd'
import { useAppStore, USER_ROLE_LABEL_KEYS } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'

/**
 * 系统设置页。
 *
 * ## i18n 命名空间口径（审计 §4.7-R24 第 1 条）
 *
 * `useTranslation(['settings','common'])` 的**第一个**命名空间就是默认命名空间，
 * 所以这里查键必须写 `t('title')` —— 改前写的是 `t('settings.title')`，
 * 实际查找 `settings:settings.title` → 永远 miss → i18next 回显 key，
 * `/settings` 整页显示 `settings.title` / `settings.nickname` / `settings.role`。
 * 根因不是词典缺失（`locales/zh-CN/settings.json` 里全部键都在）。
 * 跨命名空间的键（`common`）仍走 `t('common:save')` 的显式前缀写法。
 *
 * ## 角色下拉的 `value` 口径（审计 §4.7-R24 第 3 条）
 *
 * `value` 必须是**稳定码**（`admin` / `operator` / `guest`），显示才用 `t(...)`。
 * 改前把翻译后的显示名当 `value` 存进 store，切一次语言（「系统管理员」→「Administrator」）
 * 下拉就再也匹配不上，原样显示旧值。
 */
const Settings: React.FC = () => {
  const { t } = useTranslation(['settings', 'common'])
  const user = useAppStore((state) => state.user)
  const setUser = useAppStore((state) => state.setUser)

  const [form] = Form.useForm()

  const handleFinish = (values: { name: string; role: string; darkMode: boolean }) => {
    /* `role` 是稳定码（`admin` / `operator` / `guest`），不是显示名。 */
    setUser({ name: values.name, role: values.role })
    message.success(t('updated'))
  }

  return (
    <Card title={t('title')}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: user.name,
          role: user.role,
          darkMode: false,
        }}
        onFinish={handleFinish}
      >
        <Form.Item
          label={t('nickname')}
          name="name"
          rules={[{ required: true, message: t('validation.nicknameRequired') }]}
        >
          <Input placeholder={t('nickname')} />
        </Form.Item>

        <Form.Item
          label={t('role')}
          name="role"
          rules={[{ required: true, message: t('validation.roleRequired') }]}
        >
          <Select
            options={Object.entries(USER_ROLE_LABEL_KEYS).map(([roleCode, labelKey]) => ({
              value: roleCode,
              label: t(labelKey),
            }))}
          />
        </Form.Item>

        <Form.Item
          label={t('darkMode')}
          name="darkMode"
          valuePropName="checked"
          tooltip={t('darkModeTooltip')}
        >
          <Switch />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit">
            {t('common:save')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}

export default Settings
