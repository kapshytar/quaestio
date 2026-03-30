package com.chataggregator.app

import android.animation.ValueAnimator
import android.graphics.*
import android.graphics.drawable.Drawable
import android.view.animation.LinearInterpolator

/**
 * A drawable that renders a shimmering light reflection effect with rounded corners support.
 */
class ShimmerDrawable : Drawable() {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var shaderMatrix = Matrix()
    private var animator: ValueAnimator? = null
    private var progress = 0f
    var cornerRadius = 0f

    override fun onBoundsChange(bounds: Rect) {
        super.onBoundsChange(bounds)
        if (bounds.isEmpty) return

        val width = bounds.width().toFloat()
        // Create a gradient: transparent -> white (semi-transparent) -> transparent
        val shimmerColor = Color.argb(120, 255, 255, 255)
        val shader = LinearGradient(
            0f, 0f, width * 0.4f, 0f,
            intArrayOf(Color.TRANSPARENT, shimmerColor, Color.TRANSPARENT),
            floatArrayOf(0f, 0.5f, 1f),
            Shader.TileMode.CLAMP
        )
        paint.shader = shader
    }

    override fun draw(canvas: Canvas) {
        if (paint.shader == null) return
        
        val width = bounds.width().toFloat()
        val height = bounds.height().toFloat()
        val offset = width * 2 * progress - width
        
        shaderMatrix.setTranslate(offset, 0f)
        paint.shader?.setLocalMatrix(shaderMatrix)
        
        // Use drawRoundRect to respect chip shape
        val rectF = RectF(0f, 0f, width, height)
        canvas.drawRoundRect(rectF, cornerRadius, cornerRadius, paint)
    }

    fun startAnimation() {
        stopAnimation()
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1500
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            addUpdateListener {
                progress = it.animatedValue as Float
                invalidateSelf()
            }
            start()
        }
    }

    fun stopAnimation() {
        animator?.cancel()
        animator = null
    }

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        paint.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java", ReplaceWith("PixelFormat.TRANSLUCENT"))
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
