"""Reusable loyalty program helpers for the BrewHub terminal."""
from supabase import Client


def add_points_from_scan(barcode: str, total_spent: float, supabase: Client) -> str:
    """Award 10 points per $1 and update the cached balance."""
    customer = (
        supabase.table("loyalty_customers")
        .select("*")
        .eq("barcode_id", barcode)
        .single()
        .execute()
    )

    if not customer.data:
        return "Customer not found. Would you like to register them?"

    points = int(total_spent * 10)

    supabase.table("loyalty_transactions").insert(
        {
            "customer_id": customer.data["id"],
            "amount": total_spent,
            "points_earned": points,
        }
    ).execute()

    new_total = (customer.data.get("loyalty_points") or 0) + points
    supabase.table("loyalty_customers").update({
        "loyalty_points": new_total,
        "current_points_cache": new_total,
    }).eq("id", customer.data["id"]).execute()

    return f"Points added! New balance: {new_total}"


def redeem_reward(barcode: str, supabase: Client) -> str:
    """Redeem 500 points if available."""
    customer = (
        supabase.table("loyalty_customers")
        .select("*")
        .eq("barcode_id", barcode)
        .single()
        .execute()
    )

    if not customer.data:
        return "Customer not found."

    current_points = customer.data.get("loyalty_points") or 0
    if current_points < 500:
        return f"Not enough points ({current_points}/500)."

    new_total = current_points - 500
    supabase.table("loyalty_customers").update({
        "loyalty_points": new_total,
        "current_points_cache": new_total,
    }).eq("id", customer.data["id"]).execute()

    return f"Reward redeemed! New balance: {new_total}"
