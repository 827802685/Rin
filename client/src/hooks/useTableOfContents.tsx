import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface TableOfContent {
    index: number
    text: string
    marginLeft: number
    element: HTMLElement
}

const getHeaderScrollOffset = () => {
    const rawValue = getComputedStyle(document.documentElement)
        .getPropertyValue('--header-scroll-offset')
        .trim()
    const offset = Number.parseFloat(rawValue)
    return Number.isFinite(offset) ? offset : 0
}

const useTableOfContents = (selector: string) => {
    const intersectingListRef = useRef<boolean[]>([]) // isIntersecting array
    const [tableOfContents, setTableOfContents] = useState<TableOfContent[]>([])
    const [activeIndex, setActiveIndex] = useState(0)
    const { t } = useTranslation()
    const io = useRef<IntersectionObserver | null>(null);
    const [ref, setRef] = useState("-1")
    const lastRef = useRef("")

    useEffect(() => {
        if (lastRef.current === ref) return
        const content = document.querySelector(selector)
        if (!content) return
        const intersectingList = intersectingListRef.current
        const headers = content.querySelectorAll<HTMLElement>(
            'h1, h2, h3, h4, h5, h6'
        ) // all headers

        // set TableOfContents
        const tocData = Array.from(headers).map<TableOfContent>((header, i) => ({
            index: i,
            text: header.textContent || '',
            marginLeft: (Number(header.tagName.charAt(1)) - 1) * 10,
            element: header, // have to down little bit
        }))
        setTableOfContents(tocData)

        // create IntersectionObserver
        if (io.current) io.current.disconnect()
        io.current = new IntersectionObserver(
            (entries) => {
                // save isIntersecting info to array using data-id
                entries.forEach(({ target, isIntersecting }) => {
                    const idx = Number((target as HTMLElement).dataset.id || 0)
                    intersectingList[idx] = isIntersecting
                })
                // get activeIndex
                const currentIndex = intersectingList.findIndex((item) => item)
                let activeIndex = currentIndex - 1
                if (currentIndex === -1) {
                    activeIndex = intersectingList.length - 1
                } else if (currentIndex === 0) {
                    activeIndex = 0
                }
                setActiveIndex(activeIndex)
            },
            { rootMargin: "-20% 0px 10000px 0px", threshold: 0 }
        )
        intersectingList.length = 0 // reset array
        headers.forEach((header, i) => {
            header.setAttribute('data-id', i.toString()) // set data-id
            intersectingList.push(false) // increase array length
            io.current!.observe(header) // register to observe
        })
        lastRef.current = ref
        return () => {
            if (io.current) io.current.disconnect()
        }
    }, [ref])

    // 直接访问文章 URL 时，路由先挂载、正文后到：首轮 effect 查不到 .toc-content，
    // 而 [ref] 之后不再变化，目录就永远停在 “Index is empty”（标题 DOM 其实是有的）。
    // 目录为空时监听一次 DOM，等正文标题出现后换一个 ref 触发上面的 effect 重扫。
    useEffect(() => {
        if (tableOfContents.length > 0 || typeof MutationObserver === 'undefined') {
            return
        }
        let raf = 0
        const observer = new MutationObserver(() => {
            if (raf) return
            raf = requestAnimationFrame(() => {
                raf = 0
                const content = document.querySelector(selector)
                if (content?.querySelector('h1, h2, h3, h4, h5, h6')) {
                    observer.disconnect()
                    setRef(`mount-${Date.now()}`)
                }
            })
        })
        observer.observe(document.body, { childList: true, subtree: true })
        // 正文确实没有标题的文章：最多观察 10 秒就收手，避免常驻监听
        const timer = window.setTimeout(() => observer.disconnect(), 10000)
        return () => {
            observer.disconnect()
            window.clearTimeout(timer)
            if (raf) cancelAnimationFrame(raf)
        }
    }, [tableOfContents.length, selector])

    const cleanup = (newId: string) => {
        if (lastRef.current === newId) return
        setRef(newId)
        if (io.current) io.current.disconnect()
    }

    return {
        TOC: () => (<div className='rounded-2xl bg-w py-4 px-4 t-primary'>
            <h2 className="text-lg font-bold">{t("index.title")}</h2>
            <ul className="toc-scroll max-h-[calc(100vh-10.25rem)] overflow-auto pr-1">
                {tableOfContents.length === 0 && <li className="t-muted">{t("index.empty.title")}</li>}
                {tableOfContents.map((item) => (
                    <li
                        key={`toc$${item.index}`}
                        className={`cursor-pointer hover:opacity-50 ${activeIndex === item.index ? "text-theme" : ""}`}
                        style={{ marginLeft: item.marginLeft }}
                        onClick={() => {
                            const top = item.element.getBoundingClientRect().top + window.scrollY - getHeaderScrollOffset()
                            window.scrollTo({
                                top: Math.max(top, 0),
                                behavior: 'smooth'
                            })
                        }}
                    >
                        {item.text}
                    </li>
                ))}
            </ul>
        </div>), cleanup
    }
}

export default useTableOfContents
