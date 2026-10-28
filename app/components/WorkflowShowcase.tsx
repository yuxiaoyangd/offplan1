"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import styles from "./WorkflowShowcase.module.css";

const SCENE_DURATION = 6800;
const steps = [
  { id: "import", title: "一键导入名单", description: "零散的名字，一次导入。长长的名单，整齐进入排班。" },
  { id: "choose", title: "员工自主排休", description: "打开链接，选择上班时段和休息日期。每个人的安排，自动汇集。" },
  { id: "export", title: "一键导出排班表", description: "安排清楚，一键导出。打开排班表，整个团队的时间一目了然。" },
] as const;

const ink = "#172425";
const paper = "#f8f7f3";
const orange = "#ffb331";
const green = "#d9ef83";
const purple = "#c9c8f4";
const names = ["林小满", "陈一诺", "周子安", "许乐"];

function motionStyle(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties;
}

function Spark({ x, y, color = ink }: { x: number; y: number; color?: string }) {
  return <path d={`M${x} ${y - 10}v20m-10-10h20m-17-7 14 14m-14 0 14-14`} stroke={color} strokeWidth="2" strokeLinecap="round" />;
}

function Pointer({ className }: { className: string }) {
  return (
    <g className={className}>
      <path d="M0 0 4 26l7-7 6 12 6-3-6-11 10-2Z" fill={ink} stroke={paper} strokeWidth="2.5" strokeLinejoin="round" />
    </g>
  );
}

function ImportScene() {
  const sources = [{ x: 42, y: 83, tilt: -7 }, { x: 69, y: 142, tilt: 5 }, { x: 29, y: 201, tilt: -4 }, { x: 64, y: 256, tilt: 6 }];
  return (
    <svg className={styles.illustration} viewBox="0 0 660 360" fill="none" aria-hidden="true">
      <circle cx="126" cy="179" r="123" fill="#eeede6" />
      <circle cx="600" cy="54" r="11" stroke={ink} strokeWidth="2" />
      <Spark x={621} y={305} color="#af791a" />
      <text x="45" y="48" className={styles.svgLabel}>团队名单</text>
      <g className={styles.countBadge}>
        <rect x="143" y="26" width="75" height="28" rx="14" fill={purple} stroke={ink} strokeWidth="1.5" />
        <text x="180.5" y="45" textAnchor="middle" className={styles.svgSmall}>100+ 人</text>
      </g>

      <rect x="350" y="64" width="270" height="243" rx="17" fill={paper} stroke={ink} strokeWidth="2" />
      <path d="M350 110h270" stroke={ink} strokeWidth="1.5" />
      <text x="371" y="93" className={styles.svgLabel}>团队排班</text>
      <path d="M541 86h12m-6-6v12m18-6h31" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      {names.map((name, i) => (
        <g key={name}>
          <path d={`M368 ${153 + i * 42}h234`} stroke="#dedfd6" />
          <g className={styles.importedRow} style={motionStyle({ "--row": i })}>
            <circle cx="384" cy={135 + i * 42} r="9" fill={i % 2 ? purple : green} />
            <text x="403" y={141 + i * 42} className={styles.svgSmall}>{name}</text>
            {[0, 1, 2, 3].map(day => <rect key={day} x={479 + day * 29} y={125 + i * 42} width="21" height="19" rx="5" fill={(day + i) % 3 === 0 ? orange : green} />)}
          </g>
        </g>
      ))}

      <path d="M226 181h112" stroke="#a5ac9d" strokeWidth="1.5" strokeDasharray="4 7" />
      <g className={styles.importButton}>
        <circle cx="283" cy="181" r="28" fill={orange} stroke={ink} strokeWidth="2" />
        <path d="M270 181h25m-10-9 10 9-10 9" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {sources.map((source, i) => (
        <g key={names[i]} transform={`translate(${source.x} ${source.y})`}>
          <g className={styles.nameFlight} style={motionStyle({ "--fly-x": `${372 - source.x}px`, "--fly-y": `${116 + i * 42 - source.y}px`, "--tilt": `${source.tilt}deg`, "--row": i })}>
            <rect width="151" height="39" rx="9" fill={paper} stroke={ink} strokeWidth="1.8" />
            <circle cx="22" cy="19.5" r="9" fill={i % 2 ? purple : green} />
            <text x="43" y="26" className={styles.svgSmall}>{names[i]}</text>
            <path d="M115 16h19m-19 7h12" stroke="#9ba396" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        </g>
      ))}
      <g className={styles.importSuccess}>
        <rect x="422" y="287" width="154" height="38" rx="19" fill={green} stroke={ink} strokeWidth="1.5" />
        <path d="m438 305 5 5 9-11" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="464" y="312" className={styles.svgSmall}>名单已导入</text>
      </g>
      <Pointer className={styles.importPointer} />
    </svg>
  );
}

function ChooseScene() {
  return (
    <svg className={styles.illustration} viewBox="0 0 660 360" fill="none" aria-hidden="true">
      <circle cx="132" cy="208" r="105" fill="#eaf0da" />
      <Spark x={227} y={302} color="#af791a" />
      <g className={styles.linkCard}>
        <rect x="29" y="56" width="204" height="44" rx="12" fill={paper} stroke={ink} strokeWidth="1.8" />
        <path d="m47 79 7-7a5 5 0 0 1 7 7l-4 4m-5-10-7 7a5 5 0 0 0 7 7l4-4m-6-2 8-8" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
        <text x="75" y="84" className={styles.svgSmall}>offplan / 团队排休</text>
      </g>
      <g className={styles.person}>
        <path d="M66 279v-45c0-45 97-45 97 0v45Z" fill={orange} stroke={ink} strokeWidth="2" />
        <ellipse cx="111" cy="167" rx="31" ry="35" fill={paper} stroke={ink} strokeWidth="2" />
        <path d="M83 154q16-33 43-15m-25 25v4m20-4v4m-19 12q10 9 19-1M92 279l-8 36m57-36 8 36" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        <path d="M141 226q28 18 39-8l10-22" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        <rect x="177" y="170" width="29" height="48" rx="6" transform="rotate(13 177 170)" fill={purple} stroke={ink} strokeWidth="2" />
        <path d="M55 316h110" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      </g>
      <path d="M235 79h31m221 111h21" stroke="#9ba396" strokeWidth="1.5" strokeDasharray="4 5" />

      <rect x="270" y="20" width="210" height="320" rx="26" fill={paper} stroke={ink} strokeWidth="2.5" />
      <path d="M352 34h47" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <text x="291" y="71" className={styles.svgLabel}>我的排休</text>
      <text x="291" y="94" className={styles.svgTiny}>选择上班和休息的日期</text>
      {["一", "二", "三", "四", "五"].map((day, i) => <text key={day} x={306 + i * 34} y="120" textAnchor="middle" className={styles.svgTiny}>{day}</text>)}
      {Array.from({ length: 10 }, (_, i) => {
        const x = 291 + i % 5 * 34;
        const y = 130 + Math.floor(i / 5) * 46;
        const rest = i === 3 || i === 4 || i === 8;
        return (
          <g key={i}>
            <rect x={x} y={y} width="29" height="39" rx="7" fill="#eeede6" />
            <g className={styles.dayChoice} style={motionStyle({ "--day": i })}>
              <rect x={x} y={y} width="29" height="39" rx="7" fill={rest ? green : orange} stroke={ink} strokeWidth="1" />
              <text x={x + 14.5} y={y + 31} textAnchor="middle" className={styles.svgMicro}>{rest ? "休" : "班"}</text>
            </g>
            <text x={x + 14.5} y={y + 16} textAnchor="middle" className={styles.svgTiny}>{10 + i}</text>
          </g>
        );
      })}
      <text x="291" y="239" className={styles.svgTiny}>上班时段</text>
      <rect x="291" y="249" width="165" height="34" rx="8" fill="#eeede6" />
      <rect className={styles.timeChoice} x="291" y="249" width="165" height="34" rx="8" fill={orange} stroke={ink} strokeWidth="1" />
      <text x="303" y="271" className={styles.svgSmall}>09:00 – 18:00</text>
      <path className={styles.timeChoice} d="m432 264 4 4 8-9" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <g className={styles.choiceSaved}>
        <rect x="311" y="298" width="131" height="26" rx="13" fill={green} />
        <text x="376.5" y="316" textAnchor="middle" className={styles.svgTiny}>已保存我的安排</text>
      </g>

      <g className={styles.syncCard}>
        <rect x="509" y="119" width="125" height="148" rx="13" fill={paper} stroke={ink} strokeWidth="1.8" />
        <text x="526" y="147" className={styles.svgSmall}>团队安排</text>
        {[0, 1, 2].map(row => <g key={row}><circle cx="531" cy={171 + row * 26} r="5" fill={row === 1 ? purple : orange} /><rect x="546" y={164 + row * 26} width="29" height="14" rx="4" fill={green} /><rect x="582" y={164 + row * 26} width="32" height="14" rx="4" fill={row === 2 ? green : orange} /></g>)}
        <text x="571.5" y="251" textAnchor="middle" className={styles.svgTiny}>已同步</text>
      </g>
      <Pointer className={styles.choosePointer} />
    </svg>
  );
}

function ExportScene() {
  return (
    <svg className={styles.illustration} viewBox="0 0 660 360" fill="none" aria-hidden="true">
      <rect x="21" y="87" width="305" height="228" rx="21" transform="rotate(-5 21 87)" fill="#e9e8f1" />
      <Spark x={593} y={48} color="#af791a" />
      <circle cx="386" cy="308" r="10" stroke={ink} strokeWidth="1.8" />
      <rect x="32" y="57" width="318" height="235" rx="16" fill={paper} stroke={ink} strokeWidth="2" />
      <text x="51" y="88" className={styles.svgLabel}>团队排班</text>
      <g className={styles.exportButton}>
        <rect x="232" y="69" width="99" height="29" rx="8" fill={orange} stroke={ink} strokeWidth="1.3" />
        <text x="281.5" y="89" textAnchor="middle" className={styles.svgSmall}>一键导出</text>
      </g>
      <path d="M32 111h318" stroke={ink} strokeWidth="1.5" />
      {["一", "二", "三", "四", "五"].map((day, i) => <text key={day} x={153 + i * 39} y="135" textAnchor="middle" className={styles.svgTiny}>{day}</text>)}
      {names.map((name, row) => (
        <g key={name}>
          <text x="51" y={166 + row * 33} className={styles.svgSmall}>{name}</text>
          {[0, 1, 2, 3, 4].map(col => <rect key={col} x={139 + col * 39} y={150 + row * 33} width="28" height="23" rx="5" fill={(row + col) % 3 === 0 ? green : orange} />)}
        </g>
      ))}
      <path className={styles.exportTrail} d="M355 180h56m-10-8 10 8-10 8" stroke={ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

      <g className={styles.exportSheet}>
        <path d="M445 64h141l32 32v204a12 12 0 0 1-12 12H445a12 12 0 0 1-12-12V76a12 12 0 0 1 12-12Z" fill={paper} stroke={ink} strokeWidth="2" />
        <path d="M586 64v28a4 4 0 0 0 4 4h28" fill={green} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
        <text x="451" y="103" className={styles.svgSmall}>团队排班表</text>
        <path d="M452 119h108" stroke="#9ba396" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="450" y="137" width="151" height="119" rx="5" stroke={ink} strokeWidth="1.2" />
        <path d="M450 158h151m-151 24h151m-151 24h151m-151 24h151m-116-93v119m29-119v119m29-119v119m29-119v119" stroke="#cbd0c3" strokeWidth="1" />
        {[0, 1, 2, 3].map(row => <g key={row}><path d={`M459 ${172 + row * 24}h17`} stroke="#8c9886" strokeWidth="2" strokeLinecap="round" />{[0, 1, 2, 3].map(col => <rect key={col} x={491 + col * 29} y={164 + row * 24} width="17" height="12" rx="3" fill={(row + col) % 3 === 0 ? green : orange} />)}</g>)}
        <text x="525.5" y="280" textAnchor="middle" className={styles.svgTiny}>排班表.xlsx</text>
        <g className={styles.sheetReady}>
          <circle cx="601" cy="303" r="20" fill={green} stroke={ink} strokeWidth="1.8" />
          <path d="m591 303 7 7 13-15" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      <g className={styles.exportDone}>
        <rect x="88.5" y="306" width="202" height="29" rx="14.5" fill={green} />
        <text x="189.5" y="326" textAnchor="middle" className={styles.svgSmall}>已导出，打开即可查看</text>
      </g>
      <Pointer className={styles.exportPointer} />
    </svg>
  );
}

const scenes = [ImportScene, ChooseScene, ExportScene];

export default function WorkflowShowcase() {
  const id = useId();
  const rootRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const progressRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef(0);
  const [selection, setSelection] = useState({ index: 0, replay: 0 });
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);
  const scenePaused = !inView || !visible;
  const rotationPaused = scenePaused || reducedMotion;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const root = rootRef.current;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    if (root) observer.observe(root);
    return () => {
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (rotationPaused) return;
    let frame: number;
    let previous = performance.now();
    const tick = (now: number) => {
      elapsedRef.current += now - previous;
      previous = now;
      if (elapsedRef.current >= SCENE_DURATION) {
        elapsedRef.current = 0;
        setSelection(current => ({ index: (current.index + 1) % steps.length, replay: current.replay + 1 }));
      }
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${elapsedRef.current / SCENE_DURATION})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rotationPaused]);

  function selectStep(index: number) {
    elapsedRef.current = 0;
    if (progressRef.current) progressRef.current.style.transform = "scaleX(0)";
    setSelection(current => ({ index, replay: current.replay + 1 }));
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % steps.length;
    else if (event.key === "ArrowLeft") next = (index + steps.length - 1) % steps.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = steps.length - 1;
    else return;
    event.preventDefault();
    selectStep(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section
      ref={rootRef}
      className={styles.showcase}
      style={motionStyle({ "--scene-duration": `${SCENE_DURATION}ms` })}
      aria-label="排休流程演示"
      data-scene-paused={scenePaused}
    >
      <div className={styles.tabs} role="tablist" aria-label="选择排休流程">
        {steps.map((step, index) => (
          <button key={step.id} ref={element => { tabRefs.current[index] = element; }} type="button" role="tab" id={`${id}-${step.id}-tab`} aria-controls={`${id}-${step.id}-panel`} aria-selected={selection.index === index} tabIndex={selection.index === index ? 0 : -1} className={styles.tab} onClick={() => selectStep(index)} onKeyDown={event => handleTabKey(event, index)}>
            {selection.index === index && <span ref={progressRef} className={styles.progressFill} aria-hidden="true" />}
            <span className={styles.tabLabel}>{step.title}</span>
          </button>
        ))}
      </div>
      <div className={styles.stage}>
        {steps.map((step, index) => {
          const Scene = scenes[index];
          return (
            <div key={step.id} id={`${id}-${step.id}-panel`} role="tabpanel" aria-labelledby={`${id}-${step.id}-tab`} hidden={selection.index !== index} tabIndex={0} className={styles.panel}>
              {selection.index === index && (
                <div key={selection.replay} className={styles.sceneLayout}>
                  <div className={styles.copy}>
                    <h2>{step.title}</h2>
                    <p>{step.description}</p>
                    <span className={styles.copyLine} aria-hidden="true" />
                  </div>
                  <Scene />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
