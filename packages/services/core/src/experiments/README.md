# experiments

This directory contains handling of "experiments" across the entire stack. This is how we run on "every code push hits prod".

We generate a "hash" (value between 0 and 9999) from the experiment name and the guild ID. The database holds experiment
configuration data (ranges and overrides), which is how we determine if a guild is part of an experiment with minimal database hits.

Note: Naming convention for experiments is EXPERIMENT*NAME*[YYYY]\_[MM]

Note: Experiment data is re-polled ever 3 minutes.
