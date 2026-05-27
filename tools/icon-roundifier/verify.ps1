param([string]$Path)
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Path).Path)
$w = $bmp.Width
$h = $bmp.Height
$points = @(@(0,0),@(($w-1),0),@(0,($h-1)),@(($w-1),($h-1)),@([int]($w/2),[int]($h/2)))
"image: $Path ($w x $h)"
foreach ($p in $points) {
    $px = $bmp.GetPixel($p[0],$p[1])
    "  ({0,4},{1,4}) -> A={2,3} R={3,3} G={4,3} B={5,3}" -f $p[0],$p[1],$px.A,$px.R,$px.G,$px.B
}
$bmp.Dispose()
