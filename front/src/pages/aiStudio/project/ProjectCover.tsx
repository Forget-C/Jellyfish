import { useUiText } from '../../../uiText'
import { useState } from 'react'
import { VideoCameraOutlined } from '@ant-design/icons'
import rain from '../../home/sample-covers/rain.svg'
import changan from '../../home/sample-covers/changan.svg'
import orbit from '../../home/sample-covers/orbit.svg'

const demoCovers = new Map([['p1', rain], ['p3', changan], ['p5', orbit]])

/** 示例封面仅映射到本地演示记录，真实项目缺少封面字段时使用默认图。 */
export function ProjectCover({ projectId, demo = false, source, alt }: {
  projectId: string
  demo?: boolean
  source?: string
  alt?: string
}) {
  const uiText = useUiText()
  const [failedSource, setFailedSource] = useState<string>()
  const demoSource = demo ? demoCovers.get(projectId) : undefined
  const image = source ?? demoSource

  return (
    <div className="project-lobby-cover">
      {image && image !== failedSource ? (
        <>
          <img src={image} alt={alt ?? ''} onError={() => setFailedSource(image)} />
          {demoSource && !source && <span className="project-lobby-cover-label">{uiText("示例封面")}</span>}
        </>
      ) : (
        <span
          className="project-lobby-default-cover"
          data-pattern={Array.from(projectId).reduce((index, character) => (index * 31 + character.charCodeAt(0)) % 3, 0)}
          aria-hidden="true"
        >
          <VideoCameraOutlined />
        </span>
      )}
    </div>
  )
}
