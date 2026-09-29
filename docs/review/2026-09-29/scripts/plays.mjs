// The 18 plays a coach enters. Coordinates are field yards (x 0-30 across, y<0 downfield).
export const TEAM = { name: 'Harbor City Hawks', color: '#0b6e4f' };
export const OFFENSE_A = [
  { name: 'Trips Right Flood', moves: [['X', 21, 1], ['Z', 24, 3]], routes: [['Y', 'Go'], ['X', 'Out', { primary: true }], ['Z', 'Flat'], ['C', 'Curl']],
    notes: 'Flood the right side. QB reads high-low on the flat defender: X out at 5 is the primary, Z flat is the check-down, Y clears the safety.' },
  { name: 'Mesh', moves: [['Z', 9, 3]], routes: [['X', 'Cross', { primary: true, mirror: true }], ['Y', 'Cross'], ['Z', 'Wheel'], ['C', 'Go']],
    notes: 'X and Y cross underneath at different depths - rub the man defenders. Hit the first cross that clears. C runs off the safety.' },
  { name: 'Four Verts', moves: [['Z', 21, 1]], routes: [['X', 'Go'], ['Y', 'Go', { primary: true }], ['Z', 'Go'], ['C', 'Post']],
    notes: 'Stretch the deep zone. Read the single safety: throw away from where he turns his hips.' },
  { name: 'Slant Flat', moves: [['Z', 9, 3]], routes: [['X', 'Slant', { primary: true }], ['Z', 'Flat'], ['Y', 'Out'], ['C', 'Curl']],
    notes: 'Quick game vs press. Ball out in 2 seconds. If the flat defender jumps the slant, dump to Z in the flat.' },
  { name: 'Y Sluggo (custom)', moves: [], routes: [['X', 'Go'], ['Z', 'Flat'], ['C', 'Curl']],
    custom: ['Y', [[25, -3], [24.5, -6], [24.5, -15]], { primary: true }],
    notes: 'Double move: Y sells the slant for two steps, then climbs. Pump fake on the slant, throw the go.' },
];
export const OFFENSE_B = [
  { name: 'Stretch Right', moves: [], routes: [['Z', 'Stretch'], ['X', 'Go'], ['Y', 'Out'], ['C', 'Curl']],
    notes: 'Outside run. Z presses the edge; X and Y take their defenders deep and away. Not from the no-run zones.' },
  { name: 'Reverse Left', moves: [], routes: [['Z', 'Reverse'], ['X', 'Go'], ['Y', 'Post'], ['C', 'Curl']],
    notes: 'Misdirection. QB fakes right, Z comes back behind the QB and takes it left. Use after two Stretch Right calls.' },
  { name: 'Red Zone Fade', los: 'From the 5', moves: [], routes: [['X', 'Go', { primary: true }], ['Y', 'Corner'], ['Z', 'Flat'], ['C', 'Curl']],
    notes: 'Back-shoulder fade to X against man. Y corner holds the safety. No runs from here - passing only.' },
  { name: 'Pitch Option', moves: [], routes: [['Z', 'Pitch'], ['X', 'Corner', { primary: true }], ['Y', 'Go'], ['C', 'Curl']],
    notes: 'Z takes the pitch and reads the corner: throw if X is open, otherwise run it. Keep the pitch behind the line.' },
  { name: 'X Out-and-Up (custom)', los: 'From the 10', moves: [], routes: [['Y', 'Post'], ['Z', 'Delay'], ['C', 'Curl']],
    custom: ['X', [[3, -4], [1.8, -5], [2, -13]], { primary: true }],
    notes: 'Red zone double move. X sells the out at 4, then goes up the sideline into the end zone. Z delays as the outlet.' },
];
export const DEFENSE_A = [
  { name: 'Cover 2 Zone', moves: [['d2', 9, -10], ['d3', 21, -10], ['d5', 15, -6]],
    routes: [['d1', 'Zone flat'], ['d4', 'Zone flat'], ['d2', 'Zone deep'], ['d3', 'Zone deep'], ['d5', 'Mid-read']],
    notes: 'Two deep halves, nobody behind the safeties. Flats squeeze outside routes; the middle reads the QB eyes.' },
  { name: 'Cover 1 Man', moves: [['d3', 19, -4]],
    routes: [['d5', 'Zone deep']], man: [['d1', 'X'], ['d4', 'Y'], ['d2', 'C'], ['d3', 'Z']],
    notes: 'Man across with a single-high free safety. Stay on the hip, eyes on your man, not the QB.' },
  { name: 'Cover 3 Buzz', moves: [['d1', 4, -8], ['d4', 26, -8]],
    routes: [['d1', 'Zone deep'], ['d4', 'Zone deep'], ['d5', 'Zone deep'], ['d2', 'Curl-flat'], ['d3', 'Curl-flat']],
    notes: 'Three deep thirds, two underneath curl-flat players. Give up the short stuff, tackle (pull flags) immediately.' },
  { name: 'Rush and Spy', moves: [['d3', 15, -8], ['d2', 13, -4]],
    routes: [['d3', 'Blitz'], ['d2', 'Spy'], ['d5', 'Zone deep']], man: [['d1', 'X'], ['d4', 'Y']],
    notes: 'One rusher from 7 yards, a spy on the QB for scrambles. Corners in man, safety over the top.' },
];
export const DEFENSE_B = [
  { name: 'Zero Blitz', moves: [['d3', 15, -8], ['d5', 19, -5]],
    routes: [['d3', 'Blitz']], man: [['d1', 'X'], ['d4', 'Y'], ['d2', 'C'], ['d5', 'Z']],
    notes: 'All-out pressure. Rusher from 7 yards, everyone else in man, no help deep. Use on 3rd and long.' },
  { name: 'Cover 2 Sink', moves: [['d3', 15, -8], ['d2', 13, -7]],
    routes: [['d3', 'Blitz'], ['d1', 'Zone flat'], ['d4', 'Zone flat'], ['d2', 'Mid-read'], ['d5', 'Zone deep']],
    notes: 'Rush one, sink the middle linebacker under the crossers. Flats jump anything short and outside.' },
  { name: 'Robber (custom)', moves: [],
    routes: [['d1', 'Zone deep'], ['d4', 'Zone deep']], man: [['d2', 'C'], ['d3', 'Z']],
    custom: ['d5', [[15, -8], [12, -6.5]]],
    notes: 'Safety shows deep, then drops down to rob the crossing route at 6-7 yards. Corners play deep halves.' },
  { name: 'Goal Line Man', los: 'From the 5', moves: [],
    routes: [['d5', 'Spy']], man: [['d1', 'X'], ['d4', 'Y'], ['d2', 'C'], ['d3', 'Z']],
    notes: 'Inside the 5: tight man, inside leverage, no rush. Spy the QB - no runs allowed here, so spy plays the pass.' },
];
export const BOOKS = [
  { name: 'Hawks Base Offense', plays: OFFENSE_A.map(p => p.name) },
  { name: 'Hawks Red Zone & Specials', plays: OFFENSE_B.map(p => p.name) },
  { name: 'Hawks Base Defense', plays: DEFENSE_A.map(p => p.name) },
  { name: 'Hawks Pressure Package', plays: DEFENSE_B.map(p => p.name) },
];
