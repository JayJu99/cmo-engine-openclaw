"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

const defaultPoints = [7, 9, 8, 13, 18, 16, 15, 17, 16, 18, 23, 18, 21, 33, 24];

export function Sparkline({
  points = defaultPoints,
  tone = "violet",
  className,
}: {
  points?: number[];
  tone?: "violet" | "green" | "blue" | "orange" | "pink";
  className?: string;
}) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const width = 150;
  const height = 46;
  const line = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point - min) / Math.max(max - min, 1)) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");
  const color = {
    violet: "#6d5dfc",
    green: "#16a34a",
    blue: "#2383f6",
    orange: "#f97316",
    pink: "#ec4899",
  }[tone];

  return (
    <svg className={cn("h-12 w-full overflow-visible", className)} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`spark-${tone}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.polyline
        points={line}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#spark-${tone})`} />
    </svg>
  );
}

export function MiniProgress({
  value,
  tone = "violet",
}: {
  value: number;
  tone?: "violet" | "green" | "blue" | "orange" | "pink";
}) {
  const color = {
    violet: "bg-violet-600",
    green: "bg-emerald-500",
    blue: "bg-blue-500",
    orange: "bg-orange-500",
    pink: "bg-pink-500",
  }[tone];

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.div
        className={cn("h-full rounded-full", color)}
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
    </div>
  );
}
