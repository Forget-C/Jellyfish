import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../components'
import { Form, Input, Select, Switch, Button, message } from 'antd'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'

const Settings: React.FC = () => {
  const { t } = useTranslation(['settings', 'common'])
  const user = useAppStore((state) => state.user)
  const setUser = useAppStore((state) => state.setUser)

  const [form] = Form.useForm()

  const handleFinish = (values: { name: string; role: string; darkMode: boolean }) => {
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
          darkMode: false,
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
              { label: t('settings:roleOptions.admin'), value: t('settings:roleOptions.admin') },
              {
                label: t('settings:roleOptions.operator'),
                value: t('settings:roleOptions.operator'),
              },
              { label: t('settings:roleOptions.guest'), value: t('settings:roleOptions.guest') },
            ]}
          />
        </Form.Item>

        <Form.Item
          label={t('settings:darkMode')}
          name="darkMode"
          valuePropName="checked"
          tooltip={t('settings:darkModeTooltip')}
        >
          <Switch />
        </Form.Item>

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

