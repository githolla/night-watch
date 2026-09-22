import assert from "node:assert/strict";
import test from "node:test";
import { isLikelyPersonName } from "./pipeline.ts";

test("a real person's name is never rejected, whatever alphabet it is written in", () => {
  // This predicate decides whether a contact is stored at all, and purgeNonPeople used to DELETE everyone
  // who failed it. It was ASCII-only, so it was quietly removing exactly these people.
  for (const name of [
    "José Álvarez", "Álvaro Núñez", "François Dubois", "Renée Côté", "Zoë Müller",
    "Sebastián Piñera", "Łukasz Kowalski", "Jiří Novák", "Şule Yılmaz", "Nguyễn Văn Minh",
    "Björn Håkansson", "Müge Öztürk", "André Gonçalves", "Mónica Ruiz", "Sinéad O'Brien",
    "Ingrid Ødegård", "Csaba Kovács", "Ahmet Şahin", "Luís Filipe Sá",
  ]) {
    assert.equal(isLikelyPersonName(name), true, `should be kept: ${name}`);
  }
});

test("middle initials and Asian name tokens survive the connector test", () => {
  for (const name of [
    "Michael A Johnson", "Sarah A Chen", "An Chen", "Chen An", "An Li", "Wang An Qi",
    "Nguyen The Anh", "Tran The Vinh", "Le The Hung", "Tran To Nga", "Pham To Uyen", "Kim Do An",
  ]) {
    assert.equal(isLikelyPersonName(name), true, `should be kept: ${name}`);
  }
});

test("name particles and longer naming conventions survive", () => {
  for (const name of [
    "Maria dos Santos", "Joao das Neves", "Jan van den Berg", "Pieter ten Cate",
    "Wim ter Horst", "Ali ibn Hassan", "Abdul Rahman bin Mohammed Al Saud",
  ]) {
    assert.equal(isLikelyPersonName(name), true, `should be kept: ${name}`);
  }
});

test("marketing copy scraped as a person is still rejected", () => {
  for (const notAName of [
    "Strategic IT Guidance", "Reduced Operational Costs", "Managed Security Services",
    "Cloud Migration Support", "Our Leadership Team", "Digital Transformation Roadmap",
    "Enterprise Network Solutions",
  ]) {
    assert.equal(isLikelyPersonName(notAName), false, `should be rejected: ${notAName}`);
  }
  assert.equal(isLikelyPersonName(""), false);
  assert.equal(isLikelyPersonName("Madonna"), false, "a single token is not enough to act on");
});
