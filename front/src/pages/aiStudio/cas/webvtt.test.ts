import { describe, expect, it } from 'vitest'
import { parseWebVtt } from './webvtt'

const EP001_VTT = `WEBVTT
Language: zh-Hant

NOTE cue=1 shot=SC01 speaker=bruno_bull
c1
00:00:00.400 --> 00:00:02.000
突破了！我們回來了！

NOTE cue=2 shot=SC02 speaker=boris_bear
c2
00:00:03.400 --> 00:00:05.400
這根K棒還沒收。

NOTE cue=3 shot=SC03 speaker=bruno_bull
c3
00:00:11.000 --> 00:00:12.800
還是綠的……對吧？

NOTE cue=4 shot=SC04 speaker=milo_cat
c4
00:00:17.000 --> 00:00:19.200
你的彩帶會比收盤先到。
`

describe('parseWebVtt', () => {
  it('parses the language tag and every cue in order', () => {
    const parsed = parseWebVtt(EP001_VTT)
    expect(parsed.valid).toBe(true)
    expect(parsed.language).toBe('zh-Hant')
    expect(parsed.cues).toHaveLength(4)
    expect(parsed.cues.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('preserves exact timestamps and Traditional Chinese text', () => {
    const parsed = parseWebVtt(EP001_VTT)
    expect(parsed.cues[0]).toMatchObject({
      id: 'c1',
      start: '00:00:00.400',
      end: '00:00:02.000',
      text: '突破了！我們回來了！',
      shotId: 'SC01',
      speaker: 'bruno_bull',
    })
    expect(parsed.cues[3]).toMatchObject({
      start: '00:00:17.000',
      end: '00:00:19.200',
      text: '你的彩帶會比收盤先到。',
      shotId: 'SC04',
    })
  })

  it('rejects content that is not WebVTT', () => {
    expect(parseWebVtt('<script>alert(1)</script>').valid).toBe(false)
    expect(parseWebVtt('').valid).toBe(false)
  })

  it('keeps HTML-looking cue text as plain text (never markup)', () => {
    const hostile = `WEBVTT

c1
00:00:00.000 --> 00:00:01.000
<img src=x onerror="alert(1)">
`
    const parsed = parseWebVtt(hostile)
    expect(parsed.valid).toBe(true)
    // 解析结果只是字符串；渲染由 React 转义，不会成为 DOM 节点。
    expect(parsed.cues[0].text).toBe('<img src=x onerror="alert(1)">')
    expect(typeof parsed.cues[0].text).toBe('string')
  })

  it('tolerates CRLF and a BOM', () => {
    const parsed = parseWebVtt('﻿WEBVTT\r\nLanguage: zh-Hant\r\n\r\nc1\r\n00:00:00.000 --> 00:00:01.000\r\n測試\r\n')
    expect(parsed.valid).toBe(true)
    expect(parsed.cues[0].text).toBe('測試')
  })
})
