import changanCover from './sample-covers/changan.svg'
import rainCover from './sample-covers/rain.svg'
import orbitCover from './sample-covers/orbit.svg'
import { HomeProjectProgress } from './HomeProjectProgress'
import { HomeRecentAssets } from './HomeRecentAssets'
import { HomeRecentSessions } from './HomeRecentSessions'
import './home.css'

// 现有接口按项目读取完整画布文档。跨项目展示使用独立示例，不为示例绑定业务对象。
const sampleCanvases = [
  { title: '长安夜市 · 美术探索', project: '长安夜行', updated: '2 小时前', cover: changanCover },
  { title: '雨夜街景 · 氛围测试', project: '雨停以前', updated: '昨天', cover: rainCover },
  { title: '近地轨道 · 世界观设定', project: '轨道尽头', updated: '周一', cover: orbitCover },
]

export default function HomePage() {
  return <div className="home-page">
    <h1 className="home-title">工作概览</h1>
    <section aria-labelledby="home-recent-canvases">
      <header className="home-section-heading">
        <h2 id="home-recent-canvases">最近更新的画布</h2>
        <span className="home-sample-label">示例数据</span>
      </header>
      <div className="home-canvas-grid">
        {sampleCanvases.map(canvas => <article className="home-canvas-card" key={canvas.title}>
          <img className="home-canvas-cover" alt="" src={canvas.cover} />
          <div className="home-canvas-caption">
            <h3>{canvas.title}</h3>
            <p>{canvas.project} · {canvas.updated}</p>
          </div>
        </article>)}
      </div>
    </section>
    <div className="home-activity-grid">
      <HomeProjectProgress />
      <HomeRecentSessions />
    </div>
    <HomeRecentAssets />
  </div>
}
