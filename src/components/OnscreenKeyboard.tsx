import React from "react";

type Props = {
  onKey: (k: string) => void;
  onBackspace?: () => void;
  onEnter?: () => void;
  className?: string;
};

const Row: React.FC<{ keys: string[]; onKey: (k: string) => void }> = ({ keys, onKey }) => (
  <div className="flex justify-center gap-1">{
    keys.map((k) => (
      <button
        key={k}
        onClick={() => onKey(k)}
        className="px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-sm font-semibold active:scale-95"
        aria-label={`On-screen key ${k}`}
        type="button"
      >{k}</button>
    ))
  }</div>
);

export default function OnscreenKeyboard({ onKey, onBackspace, onEnter, className }: Props) {
  const row1 = "QWERTYUIOP".split("");
  const row2 = "ASDFGHJKL".split("");
  const row3 = "ZXCVBNM".split("");

  return (
    <div className={"w-full max-w-md mx-auto p-2 " + (className || "")}
         role="application" aria-label="On-screen keyboard">
      <div className="space-y-2">
        <Row keys={row1} onKey={(k) => onKey(k)} />
        <Row keys={row2} onKey={(k) => onKey(k)} />
        <div className="flex justify-center gap-1 items-center">
          <div className="flex gap-1">
            {row3.map((k) => (
              <button
                key={k}
                onClick={() => onKey(k)}
                className="px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-sm font-semibold active:scale-95"
                type="button"
              >{k}</button>
            ))}
          </div>
          <button
            onClick={() => onKey(" ")}
            className="ml-2 px-6 py-2 bg-stone-800 border border-stone-700 rounded-lg text-sm font-semibold"
            aria-label="Space"
            type="button"
          >Space</button>
          <button
            onClick={() => { if (onBackspace) onBackspace(); }}
            className="ml-2 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-sm font-semibold"
            aria-label="Backspace"
            type="button"
          >⌫</button>
          <button
            onClick={() => { if (onEnter) onEnter(); }}
            className="ml-2 px-3 py-2 bg-emerald-600 border border-emerald-500 rounded-lg text-sm font-semibold text-white"
            aria-label="Enter"
            type="button"
          >Enter</button>
        </div>
      </div>
    </div>
  );
}
