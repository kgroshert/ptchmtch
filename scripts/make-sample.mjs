// Generates public/samples/chorale.musicxml — a short original SATB chorale used as demo material.
import { writeFileSync } from "node:fs";

// Each voice: measures of [pitch, quarters]; pitch like "C5", "F#4".
const voices = {
  Soprano: [
    [["C5", 1], ["B4", 1], ["A4", 1], ["G4", 1]],
    [["A4", 2], ["G4", 2]],
    [["E5", 1], ["D5", 1], ["C5", 1], ["D5", 1]],
    [["E5", 4]],
    [["E5", 1], ["F5", 1], ["E5", 1], ["D5", 1]],
    [["C5", 2], ["A4", 2]],
    [["G4", 1], ["A4", 1], ["B4", 2]],
    [["C5", 4]],
  ],
  Alto: [
    [["E4", 1], ["D4", 1], ["E4", 1], ["E4", 1]],
    [["F4", 2], ["D4", 2]],
    [["G4", 1], ["G4", 1], ["F4", 1], ["G4", 1]],
    [["G4", 4]],
    [["G4", 1], ["A4", 1], ["G4", 1], ["G4", 1]],
    [["E4", 2], ["F4", 2]],
    [["E4", 1], ["F4", 1], ["D4", 2]],
    [["E4", 4]],
  ],
  Tenor: [
    [["G3", 1], ["G3", 1], ["C4", 1], ["C4", 1]],
    [["C4", 2], ["B3", 2]],
    [["C4", 1], ["B3", 1], ["A3", 1], ["B3", 1]],
    [["C4", 4]],
    [["C4", 1], ["C4", 1], ["C4", 1], ["B3", 1]],
    [["A3", 2], ["C4", 2]],
    [["C4", 1], ["C4", 1], ["G3", 2]],
    [["G3", 4]],
  ],
  Bass: [
    [["C3", 1], ["G2", 1], ["A2", 1], ["C3", 1]],
    [["F2", 2], ["G2", 2]],
    [["C3", 1], ["G2", 1], ["A2", 1], ["G2", 1]],
    [["C3", 4]],
    [["C3", 1], ["F3", 1], ["C3", 1], ["G2", 1]],
    [["A2", 2], ["F2", 2]],
    [["C3", 1], ["F2", 1], ["G2", 2]],
    [["C3", 4]],
  ],
};
const clefs = {
  Soprano: "<sign>G</sign><line>2</line>",
  Alto: "<sign>G</sign><line>2</line>",
  Tenor: "<sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change>",
  Bass: "<sign>F</sign><line>4</line>",
};
const types = { 1: "quarter", 2: "half", 4: "whole" };

function note([p, q]) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(p);
  const alter = m[2] === "#" ? "<alter>1</alter>" : m[2] === "b" ? "<alter>-1</alter>" : "";
  return `<note><pitch><step>${m[1]}</step>${alter}<octave>${m[3]}</octave></pitch><duration>${q}</duration><voice>1</voice><type>${types[q]}</type></note>`;
}

const names = Object.keys(voices);
let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>Practice Chorale in C</work-title></work>
<part-list>
${names.map((n, i) => `<score-part id="P${i + 1}"><part-name>${n}</part-name></score-part>`).join("\n")}
</part-list>
`;
names.forEach((n, i) => {
  xml += `<part id="P${i + 1}">\n`;
  voices[n].forEach((meas, mi) => {
    xml += `<measure number="${mi + 1}">`;
    if (mi === 0) {
      xml += `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef>${clefs[n]}</clef></attributes>`;
      if (i === 0) xml += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type><sound tempo="72"/></direction>`;
    }
    xml += meas.map(note).join("");
    if (mi === voices[n].length - 1) xml += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
    xml += `</measure>\n`;
  });
  xml += `</part>\n`;
});
xml += `</score-partwise>\n`;
writeFileSync(new URL("../public/samples/chorale.musicxml", import.meta.url), xml);
console.log("wrote chorale.musicxml");
