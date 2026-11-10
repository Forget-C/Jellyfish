import { useEffect } from 'react'
import { Tabs } from 'antd'
import { PageToolbar, WorkspaceLayout } from '../../../components'
import { useSearchParams } from 'react-router-dom'
import { AssetLibraryTab, assetLibraryTypes } from './AssetLibraryTab'
import type { LibraryAssetType } from './components/AssetImageCard'
import './asset-library.css'

const TAB_PARAM = 'tab'

function isValidTab(tab: string | null): tab is LibraryAssetType {
  return tab === 'actor' || tab === 'scene' || tab === 'prop' || tab === 'costume'
}

export default function AssetManager() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get(TAB_PARAM)
  const activeTab = isValidTab(tabFromUrl) ? tabFromUrl : 'actor'

  useEffect(() => {
    if (tabFromUrl === null || tabFromUrl === '') {
      const next = new URLSearchParams(searchParams)
      next.set(TAB_PARAM, 'actor')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, tabFromUrl])

  return <WorkspaceLayout className="management-page">
    <Tabs className="management-tabs asset-library-tabs" activeKey={activeTab} size="small"
      onChange={tab => {
        if (!isValidTab(tab)) return
        const next = new URLSearchParams(searchParams)
        next.set(TAB_PARAM, tab)
        setSearchParams(next, { replace: true })
      }}
      renderTabBar={(props, TabBar) => <PageToolbar title="资产库" className="management-heading">
        <TabBar {...props} />
      </PageToolbar>}
      items={(Object.keys(assetLibraryTypes) as LibraryAssetType[]).map(key => ({
        key, label: assetLibraryTypes[key].label, children: <AssetLibraryTab assetType={key} />,
      }))}
    />
  </WorkspaceLayout>
}
