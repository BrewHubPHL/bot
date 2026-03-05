"use client";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface LoyaltyCardData {
  customer_name: string;
  points: number;
  points_to_next_reward: number;
  tier: "Bronze" | "Silver" | "Gold";
  portal_url: string;
}

const TIER_STYLES: Record<string, { bg: string; accent: string; icon: string }> = {
  Gold:   { bg: "from-amber-100 to-yellow-50", accent: "text-amber-700", icon: "★" },
  Silver: { bg: "from-slate-100 to-gray-50",   accent: "text-slate-600", icon: "✦" },
  Bronze: { bg: "from-orange-50 to-stone-50",  accent: "text-orange-700", icon: "●" },
};

export default function LoyaltyPointsCard({ data }: { data: LoyaltyCardData }) {
  const style = TIER_STYLES[data.tier] || TIER_STYLES.Bronze;
  const progressPercent = Math.min(
    100,
    Math.round(((100 - data.points_to_next_reward) / 100) * 100)
  );

  return (
    <Card className={`bg-gradient-to-br ${style.bg} border-[var(--hub-tan)] shadow-md my-2 max-w-[340px]`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold text-[var(--hub-espresso)]">
            BrewHub Rewards
          </CardTitle>
          <span className={`text-xs font-semibold ${style.accent} flex items-center gap-1`}>
            {style.icon} {data.tier}
          </span>
        </div>
        <p className="text-xs text-stone-500 mt-0.5">{data.customer_name}</p>
      </CardHeader>

      <CardContent className="px-4 pb-2">
        <div className="text-center py-2">
          <span className="text-3xl font-extrabold text-[var(--hub-espresso)]">
            {data.points.toLocaleString()}
          </span>
          <span className="text-xs text-stone-500 ml-1.5">points</span>
        </div>

        {/* Progress bar toward next reward */}
        <div className="mt-1">
          <div className="flex justify-between text-[0.65rem] text-stone-500 mb-1">
            <span>Next free drink</span>
            <span>{data.points_to_next_reward} pts to go</span>
          </div>
          <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--hub-espresso)] transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </CardContent>

      <CardFooter className="px-4 pb-3 pt-1">
        <a
          href={data.portal_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-[var(--hub-espresso)] underline underline-offset-2 hover:opacity-80"
        >
          View full rewards portal
        </a>
      </CardFooter>
    </Card>
  );
}
