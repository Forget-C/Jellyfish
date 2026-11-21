import { useUiText } from '../../uiText'
import { HomeRecentCanvases } from './HomeRecentCanvases'
import { HomeProjectProgress } from './HomeProjectProgress'
import { HomeRecentAssets } from './HomeRecentAssets'
import { HomeRecentSessions } from './HomeRecentSessions'
import './home.css'

export default function HomePage() {
  const uiText = useUiText()
  return <div className="home-page">
    <h1 className="home-title">{uiText("工作概览")}</h1>
    <HomeRecentCanvases />
    <div className="home-activity-grid">
      <HomeProjectProgress />
      <HomeRecentSessions />
    </div>
    <HomeRecentAssets />
  </div>
}
