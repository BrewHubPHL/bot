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

5. Staff Management (Team Tab)
A new "Team" tab on the Manager Dashboard provides full staff directory management.

Viewing Staff: The StaffTable loads from the v_staff_status view (never directly from staff_directory). You can search by name, filter by role (Manager, Barista, Admin, Owner), and see real-time working status.

Actions: Use the action menu on each staff row to Edit Profile (name, email, phone, role), Change Role, or Deactivate a staff member (triggers instant token revocation).

Phone Numbers: Staff phone numbers can now be stored in the directory for shift-change notifications.

6. CRM & Customer Management (Insights Tab)
The CRM Insights panel shows aggregated customer metrics — total customers, app users, walk-ins, mailbox renters, VIPs, and loyalty-active counts.

Customer Table: Click "View Customers" for a full drill-down table with 8 filter presets (All, App Users, Walk-in, Mailbox, VIP, Loyalty, Active 30d, New 7d). Use the action menu for Check-in Package, Add Loyalty, or Log Manual Order.

7. Specialty Coffee Menu & Modifiers
The menu now features 7 curated specialty coffees. Each item defines which modifier groups are available:

Modifier Groups: Milks, Sweeteners, Standard Syrups, and Specialty Add-ins. Modifiers support quantity (e.g., "Sugar x3") with accurate pricing at the POS.

Catalog Updates: Use the Catalog Manager to edit long_description (origin stories, tasting notes) and allowed_modifiers per item.

8. Multi-Employee Scheduling (Calendar)
The Calendar page now supports multi-employee shift creation.

Creating Shifts: Select a time slot, then use the checkbox multi-select to assign multiple employees at once. A single action creates all shifts in batch.

Visual: Overlapping shifts render as compact colored pills (initials for 2+ employees, full name for solo). A "+X more" badge appears for slots with more than 3 assignees.

Hover Peek: Hover over a multi-employee block to see the full roster without opening the edit modal.

Batch Operations: Move or delete multiple shifts at once via the manage modal.

9. Exporting Orders
An "Export Orders" button appears in the Overview tab header. Tap it to download a CSV of all coffee orders (date, customer, items, totals) for accounting or analysis.