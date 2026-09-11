-- Direct contact details the contact agent finds on public pages.
alter table people
  add column phone text,
  add column contact_notes text;
