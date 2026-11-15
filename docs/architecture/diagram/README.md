# Architecture diagram

The diagram on the [overview](../overview.md) is built with [Archify](https://github.com/tt-a1i/archify) from `upshot.architecture.json`. The SVG is what the overview shows.

Archify also makes an interactive HTML version (pan, zoom, search, focus). It isn't committed, because it rebuilds exactly from the JSON: rendering the same source with the same Archify version (2.17.0-dev.1 here) produces the same file, byte for byte.

## Regenerating it

After editing `upshot.architecture.json`:

1. Validate it:

   ```bash
   archify validate architecture upshot.architecture.json --quality standard
   ```

2. Render the interactive HTML somewhere outside the repo:

   ```bash
   archify render architecture upshot.architecture.json /tmp/upshot-architecture.html --quality standard
   ```

3. Open the HTML, use **Export → SVG**, and save it over `upshot-architecture.svg`.

4. Lock the SVG to dark, so it doesn't switch to light for a light-scheme viewer:

   ```bash
   node -e 's=require("fs").readFileSync(process.argv[1],"utf8");
   s=s.replace(/<svg /,"<svg data-theme=\"dark\" ");
   const i=s.indexOf("@media (prefers-color-scheme: light)");
   if(i>=0){let j=s.indexOf("{",i),d=0,k=j;for(;k<s.length;k++){if(s[k]=="{")d++;else if(s[k]=="}"){d--;if(!d){k++;break}}}s=s.slice(0,i)+s.slice(k)}
   require("fs").writeFileSync(process.argv[1],s)' upshot-architecture.svg
   ```

Keep the layout about 1,000 units wide. GitHub shows the SVG at its page width, so a wider diagram shrinks the node text until it can't be read.
