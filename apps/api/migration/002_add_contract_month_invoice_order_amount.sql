-- Add user-entered monthly invoice and order amounts to existing deployments.
ALTER TABLE report_contract_monthly_rows
  ADD COLUMN invoice_amount DECIMAL(18,2) NULL AFTER acceptance_amount,
  ADD COLUMN order_amount DECIMAL(18,2) NULL AFTER invoice_amount;
