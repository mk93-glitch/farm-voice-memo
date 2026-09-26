Add-Type -Assembly System.Drawing

function Generate-Icon {
    param (
        [int]$size,
        [string]$outputPath
    )

    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # 背景色 #2e7d32
    $bgColor = [System.Drawing.ColorTranslator]::FromHtml('#2e7d32')
    $g.Clear($bgColor)

    # テキスト描画
    $brush = [System.Drawing.Brushes]::White
    $fontSize = [float]($size * 0.3)
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString("農", $font, $brush, $rect, $sf)

    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated $outputPath"
}

Generate-Icon -size 192 -outputPath "icon-192.png"
Generate-Icon -size 512 -outputPath "icon-512.png"
