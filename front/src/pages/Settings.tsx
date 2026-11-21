import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../components'
import { Form, Input, Select, Radio, Button, message } from 'antd'
import { appearances, useAppStore } from '../store/useAppStore'
import { CanvasAppearancePicker } from '../components/workbench/CanvasAppearancePicker'
import { AppearancePreview } from '../layouts/AppearancePreview'
import { useTranslation } from 'react-i18next'

const Settings: React.FC = () => {
  const { t } = useTranslation(['settings', 'common', 'layout'])
  const user = useAppStore((state) => state.user)
  const setUser = useAppStore((state) => state.setUser)
  const appearance = useAppStore((state) => state.appearance)
  const setAppearance = useAppStore((state) => state.setAppearance)

  const [form] = Form.useForm()

  const handleFinish = (values: { name: string; role: string }) => {
    setUser({ name: values.name, role: values.role })
    message.success(t('settings:updated'))
  }

  return (
    <WorkspaceLayout>
      <PageToolbar title={t('settings:title')} />
      <WorkspaceScrollPanel className="app-page-content">
      <div className="app-settings-form">
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: user.name,
          role: user.role,
        }}
        onFinish={handleFinish}
      >
        <Form.Item
          label={t('settings:nickname')}
          name="name"
          rules={[{ required: true, message: t('settings:validation.nicknameRequired') }]}
        >
          <Input placeholder={t('settings:nickname')} />
        </Form.Item>

        <Form.Item
          label={t('settings:role')}
          name="role"
          rules={[{ required: true, message: t('settings:validation.roleRequired') }]}
        >
          <Select
            options={[
              { label: t('settings:roleOptions.admin'), value: 'admin' },
              {
                label: t('settings:roleOptions.operator'),
                value: 'operator',
              },
              { label: t('settings:roleOptions.guest'), value: 'guest' },
            ]}
          />
        </Form.Item>

        <Form.Item label={t('layout:appearance.label')}>
          <div role="radiogroup" aria-label={t('layout:appearance.label')}>
            <Radio.Group className="app-appearance-options" name="appearance" value={appearance}
              onChange={event => setAppearance(event.target.value)}>
              {appearances.map(value => <Radio key={value} value={value}><AppearancePreview appearance={value} /></Radio>)}
            </Radio.Group>
          </div>
        </Form.Item>

        <Form.Item label={t('layout:canvasAppearance.label')}><CanvasAppearancePicker /></Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit">
            {t('common:save')}
          </Button>
        </Form.Item>
      </Form>
      </div>
      </WorkspaceScrollPanel>
    </WorkspaceLayout>
  )
}

export default Settings

