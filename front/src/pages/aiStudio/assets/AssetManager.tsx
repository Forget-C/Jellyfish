import { useEffect, useState } from 'react'
import { Card, Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { ActorsTab } from './tabs/ActorsTab'
import { ScenesTab } from './tabs/ScenesTab'
import { PropsTab } from './tabs/PropsTab'
import { CostumesTab } from './tabs/CostumesTab'
import { ScrollablePage } from '../components/ScrollablePage'

const TAB_PARAM = 'tab'
type AssetTabKey = 'actor' | 'scene' | 'prop' | 'costume'

function isValidTab(tab: string | null): tab is AssetTabKey {
  return tab === 'actor' || tab === 'scene' || tab === 'prop' || tab === 'costume'
}

const AssetManager = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get(TAB_PARAM)

  const [activeTab, setActiveTab] = useState<AssetTabKey>(() => (isValidTab(tabFromUrl) ? tabFromUrl : 'actor'))

  useEffect(() => {
    if (isValidTab(tabFromUrl)) {
      setActiveTab(tabFromUrl)
    } else if (tabFromUrl === null || tabFromUrl === '') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(TAB_PARAM, 'actor')
          return next
        },
        { replace: true },
      )
    }
  }, [tabFromUrl, setSearchParams])

  const setTabInUrl = (tab: AssetTabKey) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set(TAB_PARAM, tab)
        return next
      },
      { replace: true },
    )
  }

  return (
    <ScrollablePage className="pr-1">
      <div className="space-y-4">
        <Card>
          <Tabs
            activeKey={activeTab}
            onChange={(k) => {
              if (isValidTab(k)) setTabInUrl(k)
            }}
            items={[
              { key: 'actor', label: '演员', children: <ActorsTab /> },
              { key: 'scene', label: '场景', children: <ScenesTab /> },
              { key: 'prop', label: '道具', children: <PropsTab /> },
              { key: 'costume', label: '服装', children: <CostumesTab /> },
            ]}
          />
        </Card>
      </div>
    </ScrollablePage>
  )
}

export default AssetManager
