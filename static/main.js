import { initPlayer } from './player.js';
import { initRatings } from './ratings.js';
import { initMetadata } from './metadata.js';

// Ratings must subscribe before the first metadata response can arrive.
initPlayer();
initRatings();
initMetadata();
