import { useState } from 'react'
import { VideoCameraOutlined } from '@ant-design/icons'
import rain from '../../home/sample-covers/rain.svg'
import changan from '../../home/sample-covers/changan.svg'
import orbit from '../../home/sample-covers/orbit.svg'

const demoCovers = new Map([['p1', rain], ['p3', changan], ['p5', orbit]])

/** 示例封面仅映射到本地演示记录，真实项目缺少封面字段时使用默认图。 */
export function ProjectCover({ projectId, demo }: { projectId: string; demo: boolean }) {
  const [failed, setFailed] = useState(false)
  const source = demo ? demoCovers.get(projectId) : undefined

  return (
    <div className="project-lobby-cover">
      {source && !failed ? (
        <>
          <img src={source} alt="" onError={() => setFailed(true)} />
          <span className="project-lobby-cover-label">示例封面</span>
        </>
      ) : <VideoCameraOutlined aria-hidden />}
    </div>
  )
}
