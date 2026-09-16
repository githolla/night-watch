-- A stable daily worklist: the day a card was placed on the desk's worklist. Set once at the first open of the
-- day, so the list stays fixed through the day (worked items stay in place, marked, instead of reshuffling).
alter table cards add column if not exists worklist_on date;
create index if not exists cards_worklist on cards(worklist_on) where worklist_on is not null;
