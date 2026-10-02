import {
  EDUCATION_CAMPUS_SETBACK,
  educationCampusConflict
} from '../src/placement/siteRules.js';

const campus = {
  facility: 'college',
  cell: [20, 20],
  footprint: [[20, 20], [21, 20], [22, 20], [20, 21], [21, 21], [22, 21]]
};
const town = { buildings: [campus] };
const near = educationCampusConflict(town, [[20, 24], [21, 24], [22, 24], [20, 25], [21, 25], [22, 25]], 'university');
const oppositeRoad = educationCampusConflict(town, [[20, 23], [21, 23], [22, 23]], 'university');
const far = educationCampusConflict(town, [[20, 30], [21, 30], [22, 30]], 'university');
const ordinary = educationCampusConflict(town, [[20, 23]], 'library');
const landmark = educationCampusConflict(town, [[20, 23]], 'campus');

const failures = [
  ...(EDUCATION_CAMPUS_SETBACK < 2 ? ['campus buffer is too small to cover a road-facing opposite lot'] : []),
  ...(!near ? ['nearby campuses were accepted'] : []),
  ...(!oppositeRoad ? ['campuses across a road were accepted'] : []),
  ...(far ? ['campuses with a real catchment buffer were rejected'] : []),
  ...(ordinary ? ['ordinary civic buildings were incorrectly treated as campuses'] : []),
  ...(!landmark ? ['university landmark campuses were not protected'] : [])
];

console.log(JSON.stringify({
  ok: failures.length === 0,
  setback: EDUCATION_CAMPUS_SETBACK,
  near: !!near,
  oppositeRoad: !!oppositeRoad,
  far: !!far,
  ordinary: !!ordinary,
  landmark: !!landmark,
  failures
}));
process.exit(failures.length ? 1 : 0);
