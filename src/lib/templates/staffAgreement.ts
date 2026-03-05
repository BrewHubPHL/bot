/**
 * BrewHub PHL — Staff Agreement Template
 * Location: src/lib/templates/staffAgreement.ts
 * * This file exports the master employment contract and profit-sharing addendum.
 * It uses template literals to inject dynamic employee data from the database.
 */

interface AgreementData {
  employeeName: string;
  baseRate: string;
  effectiveDate: string;
  noticePeriodDays: number;
}

export const generateStaffAgreement = (data: AgreementData): string => {
  const { employeeName, baseRate, effectiveDate, noticePeriodDays } = data;

  return `
☕ BREWHUB PHL — MUTUAL WORKING AGREEMENT
--------------------------------------------------
Effective Date: ${effectiveDate}
Between: BrewHub PHL ("The Company") 
And: ${employeeName} ("The Employee")

ARTICLE 1: RECOGNITION & PURPOSE
1.1 Scope: This agreement covers all hourly staff (Baristas, Shift Leads, and Hub Operators) employed at BrewHub PHL, located in Point Breeze, Philadelphia. 
1.2 Purpose: To establish clear, fair, and transparent working conditions, wage rates, and operational protocols that benefit both the business and the neighborhood it serves.

ARTICLE 2: HOURS OF WORK, SCHEDULING, & TIME TRACKING
2.1 The Workweek: The standard workweek begins on Monday at 12:00 AM and ends on Sunday at 11:59 PM. 
2.2 Time Tracking: All time is tracked strictly via the BrewHub Staff Portal (/staff-hub). Employees must use their secure PIN to clock in/out. 
2.3 Missed Punches: System flags a "Missing Clock-Out" after 16 hours. Management must be notified within 24 hours for correction. 
2.4 Schedule Changes: Management will post schedules at least ${noticePeriodDays} days in advance. Shift swaps require Manager approval via the platform.

ARTICLE 3: WAGES & PREMIUM PAY (STACKING)
3.1 Base Rate: The Employee's starting base wage is $${baseRate}/hr. 
3.2 Overtime (1.5x): Hours in excess of 40.0 per workweek paid at 1.5x base rate. 
3.3 Sunday Premium (1.5x): All regular hours worked on Sundays are paid at a premium rate of 1.5x base rate. 
3.4 Sunday Overtime (2.0x): If 40 hours are exceeded for the week, subsequent hours worked on Sunday are paid at double time (2.0x). 
3.5 Pay Periods: Wages calculated bi-weekly and paid via direct deposit.

ARTICLE 4: HEALTH, SAFETY, & ENVIRONMENT
4.1 Zero Tolerance: Harassment, discrimination, or abusive behavior is strictly prohibited. 
4.2 The "Philly Way" Protocol: Staff are empowered to refuse service to any customer who is verbally abusive or compromises safety. 
4.3 Emergency Protocols: Employees are trained on silent panic alarms and cash drops. No liability for shortages during verified security incidents.

ARTICLE 5: DISCIPLINE & THE "JUST CAUSE" STANDARD
5.1 Just Cause: Management must have a valid, documented reason for discipline or discharge. 
5.2 Progressive Discipline: Step 1: Verbal Warning; Step 2: Written Warning; Step 3: Final Warning/Suspension; Step 4: Termination. 
5.3 Digital Revocation: Upon termination, digital tokens are incremented, instantly revoking access to POS, KDS, and Parcel Hub.

ARTICLE 6: GRIEVANCE PROCEDURE
6.1 Dispute Resolution: Initially raised with Shift Lead. 
6.2 Owner Review: Unresolved issues submitted in writing to the Owner; meeting held within 5 business days.

ARTICLE 7: ENTIRE AGREEMENT & ADDENDA
7.1 Incorporation: This Agreement, along with the Profit Sharing Addendum (Exhibit A), constitutes the entire agreement. 
7.2 Acknowledgment: By signing, the Employee accepts the terms of the Addendum, which is incorporated herein by reference.

ARTICLE 8: ACKNOWLEDGMENT
By signing below, both parties agree to uphold the standards of BrewHub PHL.

Employer Signature: ___________________________ Date: ___________
Employee Signature: ___________________________ Date: ___________

--------------------------------------------------
📜 EXHIBIT A: PROFIT SHARING ADDENDUM
--------------------------------------------------

1. ELIGIBILITY & VESTING
- Vesting: Participation begins after six (6) months of continuous employment.
- Probation: The first 90 days are a training period and do not count toward vesting.

2. THE POOL CALCULATION
- Profit Floor: Sharable Pool is generated only if monthly Net Profit exceeds $5,000.00.
- Sharing Percentage: 10% of Net Profit above the floor is contributed to a quarterly pool.
- Net Profit Definition: Revenue minus all OpEx (Rent, Payroll, COGS, and Equipment Maintenance).

3. DISTRIBUTION LOGIC
- Hours-Based: Distributed proportionally based on total hours worked by eligible staff during the quarter.
- Formula: (Employee Hours / Total Eligible Team Hours) x Total Pool Amount.

4. TRANSPARENCY
- Dashboard Access: Live "Profit Share Progress Bar" is visible on the Manager-approved staff view.
- Frequency: Payouts occur on the first payroll cycle following the end of each fiscal quarter.
`.trim();
};