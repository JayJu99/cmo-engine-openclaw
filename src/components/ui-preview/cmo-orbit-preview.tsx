"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Cuboid,
  Database,
  FileText,
  Grid2X2,
  Heart,
  Network,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Wallet,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";

import styles from "./cmo-orbit-preview.module.css";

const statItems = [
  { icon: CircleDot, value: "76%", label: "Context" },
  { icon: Database, value: "5", label: "Sources" },
  { icon: Network, value: "3", label: "Decisions" },
  { icon: SlidersHorizontal, value: "12", label: "Signals" },
];

const navItems = [
  { icon: CircleDot, active: true, label: "Orbit" },
  { icon: Grid2X2, label: "Apps" },
  { icon: Cuboid, label: "Models" },
  { icon: FileText, label: "Docs" },
  { icon: Settings, label: "Settings" },
];

const tabs = [
  { icon: CircleDot, label: "Hold Pay", active: true },
  { icon: Box, label: "Mini App" },
  { icon: Shield, label: "AION" },
  { icon: Heart, label: "Feedback" },
  { icon: Wallet, label: "Wallet" },
];

const alerts = [
  { icon: AlertCircle, label: "2 apps need attention", tone: "orange" },
  { icon: Workflow, label: "3 new sources", tone: "violet" },
  { icon: SlidersHorizontal, label: "4 open decisions", tone: "violet" },
];

function IconButton({ children, className = "", label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <button className={`${styles.iconButton} ${className}`} aria-label={label} title={label} type="button">
      {children}
    </button>
  );
}

function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>
          <CircleDot size={25} />
        </span>
        <span>CMO Engine</span>
      </div>

      <nav className={styles.sideNav} aria-label="Preview primary">
        {navItems.map(({ icon: Icon, active, label }) => (
          <IconButton key={label} className={active ? styles.active : ""} label={label}>
            <Icon size={24} />
          </IconButton>
        ))}
      </nav>

      <button className={styles.profileCard} aria-label="Account menu" type="button">
        <span className={styles.avatar}>H</span>
        <span className={styles.statusDot} />
        <ChevronDown size={16} />
      </button>
    </aside>
  );
}

function Header() {
  return (
    <header className={styles.topbar}>
      <div className={styles.titleRow}>
        <h1>CMO Orbit</h1>
        <span className={styles.divider} />
        <span>Command Center</span>
      </div>
      <div className={styles.headerActions}>
        <IconButton label="Search">
          <Search size={25} />
        </IconButton>
        <button className={styles.accountPill} aria-label="Account" type="button">
          H
        </button>
        <IconButton label="Expand account">
          <ChevronDown size={18} />
        </IconButton>
      </div>
    </header>
  );
}

function StatsStrip() {
  return (
    <div className={styles.statsStrip}>
      {statItems.map(({ icon: Icon, value, label }) => (
        <div className={styles.statItem} key={label}>
          <Icon size={25} />
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function SnapshotCard() {
  return (
    <aside className={styles.snapshotCard}>
      <p>Snapshot</p>
      {statItems.map(({ icon: Icon, value, label }) => (
        <div className={styles.snapshotRow} key={label}>
          <Icon size={25} />
          <div>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        </div>
      ))}
    </aside>
  );
}

function OrbitalVideoAsset() {
  return (
    <div className={styles.orbitalVideoWrap} aria-hidden="true">
      <video
        className={styles.orbitalHeroVideo}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/cmo-orbit/orbital-motion-poster.webp"
      >
        <source src="/cmo-orbit/orbital-motion.webm" type="video/webm" />
        <source src="/cmo-orbit/orbital-motion.mp4" type="video/mp4" />
      </video>
    </div>
  );
}

function HeroPanel() {
  return (
    <section className={styles.heroPanel}>
      <div className={`${styles.heroArc} ${styles.heroArcOne}`} />
      <div className={`${styles.heroArc} ${styles.heroArcTwo}`} />

      <IconButton className={`${styles.heroArrow} ${styles.left}`} label="Previous">
        <ArrowLeft size={24} />
      </IconButton>
      <IconButton className={`${styles.heroArrow} ${styles.right}`} label="Next">
        <ArrowRight size={24} />
      </IconButton>

      <div className={styles.heroCopy}>
        <h2>Hold Pay</h2>
        <p>Payments infrastructure for World App builders</p>
        <div className={styles.attentionPill}>
          <span />
          Needs Attention
        </div>
        <StatsStrip />
        <div className={styles.heroActions}>
          <button className={styles.primaryCta} type="button">
            Open Project
            <ArrowRight size={22} />
          </button>
        </div>
      </div>

      <div className={styles.orbitalStage} aria-label="Animated Hold Pay intelligence object">
        <div className={styles.stageGlow} />
        <OrbitalVideoAsset />
      </div>

      <SnapshotCard />

      <div className={styles.tabBar} role="tablist" aria-label="Project modules">
        {tabs.map(({ icon: Icon, label, active }) => (
          <button
            className={`${styles.tabItem} ${active ? styles.active : ""}`}
            key={label}
            role="tab"
            aria-selected={active}
            type="button"
          >
            <span>
              <Icon size={24} />
            </span>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function AlertBand() {
  return (
    <section className={styles.alertBand}>
      {alerts.map(({ icon: Icon, label, tone }) => (
        <button className={styles.alertItem} key={label} type="button">
          <span className={`${styles.alertIcon} ${tone === "orange" ? styles.orange : styles.violet}`}>
            <Icon size={25} />
          </span>
          <span>{label}</span>
          <ChevronRight size={20} />
        </button>
      ))}
    </section>
  );
}

export function CmoOrbitPreview() {
  return (
    <div className={styles.previewShell}>
      <Sidebar />
      <main className={styles.mainArea}>
        <Header />
        <HeroPanel />
        <AlertBand />
      </main>
    </div>
  );
}
