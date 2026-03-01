📖 BrewHub PHL: Manager’s Operational Manual
This document serves as the source of truth for handling physical cafe reality through our digital infrastructure.

1. Handling Inventory & Breakage
The system no longer allows "silent" stock changes to ensure IRS-compliant audit trails.

Restocking Items: Go to the Catalog Manager. Tap a product (e.g., "House Espresso") and enter the new total in the Stock Quantity field.

Reporting Breakage: If a glass mug or retail item breaks, tap the "Report Spoilage / Breakage" button.

Why?: You must enter a reason and quantity. This creates an immutable record in the Inventory Shrinkage Log so the owner knows exactly why $25 in retail value vanished.

2. Payroll Adjustments & Staff Safety
Payroll edits are high-security actions.

Clock-Out Fixes: If a barista forgets to clock out, use the Fix Clock-Out button to set the correct time.

Shift Overrides: To change past hours, click "Adjust Hours". You must provide a reason of at least 10 characters and pass a TOTP/PIN Challenge.

Staff Exhaustion: Watch the Live Staff Pulse in the dashboard header. If the badge turns RED, a staff member has been on-site for over 16 hours and must be sent home immediately for safety and liability reasons.

3. The "Offline" Protocol
If the cafe Wi-Fi dies, the POS iPad will automatically enter CASH ONLY MODE.

The Cap: You can process up to $200 in cash sales while offline.

Do Not Refresh: Tell staff never to refresh the browser or clear cache while the red "OFFLINE" banner is visible.

Auto-Sync: Once Wi-Fi returns, the system will silently sync all orders to the database. Verify the "Connection Restored" green banner appears.

4. Outbound Shipping (FedEx)
For residents dropping off packages to ship:

POS Intake: Use the "Shipping/Parcels" tab on the POS.

Open Pricing: Since rates are currently TBD, enter the price quoted from the FedEx portal manually into the Open Price field.

The Monitor: Once paid, the package will appear in CYAN on the Parcel Departure Board as "Awaiting FedEx Pickup".